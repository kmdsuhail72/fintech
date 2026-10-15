"""Render, validate, migrate, and roll out an explicitly selected Kubernetes target."""
import argparse
import copy
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import yaml

ROOT = Path(__file__).resolve().parents[2]
APPS = {"frontend", "api", "ai-service"}


def checked_manifest(text):
    if "REPLACE" in text or "example.com" in text or "sha256:" + "0" * 64 in text:
        raise ValueError("Replace all image, domain, IAM, certificate and network placeholders before deployment.")
    documents = list(yaml.safe_load_all(text))
    namespaces = [d["metadata"]["name"] for d in documents if d["kind"] == "Namespace"]
    if len(namespaces) != 1:
        raise ValueError("Exactly one application namespace is required.")
    deployments = {d["metadata"]["name"]: d for d in documents if d["kind"] == "Deployment"}
    if set(deployments) != APPS:
        raise ValueError("All three application deployments must be present.")
    for deployment in deployments.values():
        image = deployment["spec"]["template"]["spec"]["containers"][0]["image"]
        if not re.fullmatch(r"[\w./:-]+@sha256:[0-9a-f]{64}", image):
            raise ValueError("Promote immutable, scanned image digests for every application.")
    return documents, namespaces[0], deployments


def migration_job(template, namespace, release, image):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,35}", release):
        raise ValueError("Release must be a short lowercase DNS-safe identifier.")
    job = copy.deepcopy(template)
    job["metadata"] = {"name": "asteriq-migration-" + release, "namespace": namespace}
    job["spec"]["template"]["spec"]["containers"][0]["image"] = image
    return job


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True, help="Explicit context; never uses current-context implicitly")
    parser.add_argument("--overlay", default=str(ROOT / "k8s/environments/production"))
    parser.add_argument("--release", required=True)
    parser.add_argument("--render-only", action="store_true")
    args = parser.parse_args()
    rendered = subprocess.run(["kubectl", "kustomize", args.overlay], capture_output=True, text=True, check=True).stdout
    documents, namespace, deployments = checked_manifest(rendered)
    job = migration_job(yaml.safe_load((ROOT / "k8s/jobs/migration.example.yaml").read_text()),
        namespace, args.release, deployments["api"]["spec"]["template"]["spec"]["containers"][0]["image"])
    if args.render_only:
        print(yaml.safe_dump_all(documents + [job], sort_keys=False))
        return

    def kubectl(*options):
        subprocess.run(["kubectl", "--context", args.context, "--request-timeout=30s", *options], check=True)

    with tempfile.TemporaryDirectory(prefix="asteriq-kubernetes-") as directory:
        def apply_docs(name, docs, dry_run=False):
            file = Path(directory) / (name + ".yaml")
            file.write_text(yaml.safe_dump_all(docs, sort_keys=False), encoding="utf-8")
            kubectl("apply", "--server-side", "--field-manager=asteriq-platform",
                *( ["--dry-run=server"] if dry_run else []), "-f", str(file))

        # Namespace existence is required for server admission of namespaced objects.
        apply_docs("namespace", [d for d in documents if d["kind"] == "Namespace"])
        apply_docs("admission", documents + [job], dry_run=True)
        setup = [d for d in documents if d["kind"] not in {
            "Namespace", "Deployment", "HorizontalPodAutoscaler", "Ingress", "PodDisruptionBudget"}]
        apply_docs("setup", setup)
        for name in ("api-secrets", "ai-service-secrets", "migration-secrets"):
            kubectl("-n", namespace, "wait", "externalsecret/" + name, "--for=condition=Ready", "--timeout=180s")
        apply_docs("migration", [job])
        kubectl("-n", namespace, "wait", "job/" + job["metadata"]["name"], "--for=condition=Complete", "--timeout=660s")
        workloads = copy.deepcopy([d for d in documents if d["kind"] == "Deployment"])
        new_workloads = {}
        for workload in workloads:
            name = workload["metadata"]["name"]
            existing = subprocess.run(["kubectl", "--context", args.context, "--request-timeout=30s",
                "-n", namespace, "get", "deployment", name, "--ignore-not-found", "-o", "name"],
                capture_output=True, text=True, check=True)
            if not existing.stdout.strip():
                new_workloads[name] = workload["spec"].get("replicas", 3)
            # Promotion must not reset an HPA-scaled workload to the base replica count.
            workload["spec"].pop("replicas", None)
        for name in ("ai-service", "api", "frontend"):
            apply_docs(name, [w for w in workloads if w["metadata"]["name"] == name])
            if name in new_workloads:
                kubectl("-n", namespace, "scale", "deployment/" + name, "--replicas=" + str(new_workloads[name]),
                    "--field-manager=asteriq-initial-scale")
            apply_docs(name + "-availability", [d for d in documents if d["kind"] in {
                "HorizontalPodAutoscaler", "PodDisruptionBudget"} and d["metadata"]["name"] == name])
            kubectl("-n", namespace, "rollout", "status", "deployment/" + name, "--timeout=600s")
        apply_docs("ingress", [d for d in documents if d["kind"] == "Ingress"])
        print(json.dumps({"namespace": namespace, "release": args.release, "status": "rolled-out"}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f"Deployment halted: {error}", file=sys.stderr)
        sys.exit(1)
