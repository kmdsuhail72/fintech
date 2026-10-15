"""Validate integration between rendered workloads, networking and deployment guardrails."""
import importlib.util
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("kubernetes_deploy", ROOT / "scripts/kubernetes/deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


@pytest.fixture(scope="module")
def rendered():
    text = subprocess.run(["kubectl", "kustomize", str(ROOT / "k8s/environments/production")],
        capture_output=True, text=True, check=True).stdout
    return text, list(yaml.safe_load_all(text))


def test_every_service_targets_the_correct_ready_workload(rendered):
    _, docs = rendered
    deployments = {d["metadata"]["name"]: d for d in docs if d["kind"] == "Deployment"}
    for service in (d for d in docs if d["kind"] == "Service"):
        workload = deployments[service["metadata"]["name"]]["spec"]["template"]
        assert service["spec"]["selector"] == workload["metadata"]["labels"]
        port = workload["spec"]["containers"][0]["ports"][0]
        assert service["spec"]["ports"][0]["targetPort"] == port["name"]
        assert service["spec"]["ports"][0]["port"] == port["containerPort"]
    assert set(deployments) == deploy.APPS


def test_security_and_rollout_with_drain_time(rendered):
    _, docs = rendered
    for d in (d for d in docs if d["kind"] == "Deployment"):
        expected_minimum = {"frontend": 2, "api": 3, "ai-service": 2}[d["metadata"]["name"]]
        assert d["spec"]["replicas"] >= expected_minimum
        assert d["spec"]["strategy"]["rollingUpdate"]["maxUnavailable"] == 0
        pod = d["spec"]["template"]["spec"]
        c = pod["containers"][0]
        assert pod["securityContext"]["runAsNonRoot"] is True
        assert pod["automountServiceAccountToken"] is False
        assert c["securityContext"]["readOnlyRootFilesystem"] is True
        assert pod["terminationGracePeriodSeconds"] >= 35 + 100 + 15
        for probe in ("startupProbe", "readinessProbe", "livenessProbe"):
            assert c[probe]["httpGet"]["port"] == "http"
        assert c["resources"]["requests"]["cpu"]
        assert c["resources"]["limits"]["memory"]


def test_private_callbacks_have_both_ingress_and_egress(rendered):
    _, docs = rendered
    policies = {d["metadata"]["name"]: d["spec"] for d in docs if d["kind"] == "NetworkPolicy"}
    assert policies["default-deny"]["ingress"] == []
    assert policies["default-deny"]["egress"] == []
    assert policies["ai-internal"]["egress"][0]["to"][0]["podSelector"]["matchLabels"]["app.kubernetes.io/name"] == "api"
    allowed = policies["api-internal"]["ingress"][0]["from"]
    assert {p["podSelector"]["matchLabels"]["app.kubernetes.io/name"] for p in allowed} == {"frontend", "ai-service"}
    ingress = next(d for d in docs if d["kind"] == "Ingress")
    assert ingress["spec"]["rules"][0]["http"]["paths"][0]["backend"]["service"]["name"] == "frontend"


def test_unconfigured_deployment_is_blocked_and_job_uses_release_digest(rendered):
    with pytest.raises(ValueError, match="Replace all"):
        deploy.checked_manifest(rendered[0])
    template = yaml.safe_load((ROOT / "k8s/jobs/migration.example.yaml").read_text())
    image = "registry.example/api@sha256:" + "a" * 64
    job = deploy.migration_job(template, "asteriq-production", "abc123", image)
    container = job["spec"]["template"]["spec"]["containers"][0]
    assert container["image"] == image
    assert container["envFrom"][0]["secretRef"]["name"] == "migration-secrets"
    assert "migration-secrets" != "api-secrets"
    assert template["metadata"]["name"] != job["metadata"]["name"]


def test_yaml_has_no_duplicate_keys():
    class UniqueLoader(yaml.SafeLoader):
        pass

    def mapping(loader, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            assert key not in result, f"Duplicate YAML key: {key}"
            result[key] = loader.construct_object(value_node, deep=deep)
        return result

    UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    for path in (ROOT / "k8s").rglob("*.yaml"):
        list(yaml.load_all(path.read_text(), Loader=UniqueLoader))


@pytest.mark.parametrize("bootstrap_count", [1, 2, 3])
def test_promotion_preserves_hpa_replicas_and_migrates_before_rollout(rendered, monkeypatch, bootstrap_count):
    # Synthetic configured input; no subprocess or cluster mutation is performed.
    text = rendered[0].replace("REPLACE", "configured").replace("example.com", "example.net")
    text = text.replace("sha256:" + "0" * 64, "sha256:" + "a" * 64)
    input_docs = list(yaml.safe_load_all(text))
    for doc in input_docs:
        if doc["kind"] == "Deployment":
            doc["spec"]["replicas"] = bootstrap_count
        if doc["kind"] == "HorizontalPodAutoscaler":
            doc["spec"]["minReplicas"] = bootstrap_count
    text = yaml.safe_dump_all(input_docs, sort_keys=False)
    applied, calls = [], []

    def run(command, **kwargs):
        calls.append(command)
        if command[:2] == ["kubectl", "kustomize"]:
            return SimpleNamespace(stdout=text)
        if "get" in command and "deployment" in command:
            name = command[command.index("deployment") + 1]
            return SimpleNamespace(stdout="" if name == "frontend" else "deployment.apps/" + name)
        if "apply" in command and "--dry-run=server" not in command:
            file = Path(command[command.index("-f") + 1])
            applied.extend(yaml.safe_load_all(file.read_text()))
        return SimpleNamespace(stdout="")

    monkeypatch.setattr(deploy.subprocess, "run", run)
    monkeypatch.setattr(sys, "argv", ["deploy.py", "--context", "explicit-context", "--release", "abc123"])
    deploy.main()
    workloads = [d for d in applied if d["kind"] == "Deployment"]
    assert len(workloads) == 3 and all("replicas" not in d["spec"] for d in workloads)
    assert [d["metadata"]["name"] for d in workloads] == ["ai-service", "api", "frontend"]
    scales = [call for call in calls if "scale" in call]
    assert len(scales) == 1 and "deployment/frontend" in scales[0]
    assert "--replicas=" + str(bootstrap_count) in scales[0]
    kinds = [d["kind"] for d in applied]
    assert kinds.index("Job") < kinds.index("Deployment") < kinds.index("Ingress")
    assert all("--context" in call for call in calls if call[:2] != ["kubectl", "kustomize"])


@pytest.mark.parametrize("environment,minimum", [("dev", 1), ("staging", 2), ("production", 3)])
def test_environment_namespace_config_and_secrets_are_isolated(environment, minimum):
    result = subprocess.run(["kubectl", "kustomize", str(ROOT / "k8s/environments" / environment)],
        capture_output=True, text=True, check=True)
    docs = list(yaml.safe_load_all(result.stdout))
    namespace = "asteriq-" + environment
    assert [d["metadata"]["name"] for d in docs if d["kind"] == "Namespace"] == [namespace]
    assert all(d["metadata"]["namespace"] == namespace for d in docs if d["kind"] != "Namespace")
    for d in docs:
        expected_minimum = ({"frontend": 2, "api": 3, "ai-service": 2}.get(d["metadata"]["name"], minimum)
                            if environment == "production" else minimum)
        if d["kind"] == "Deployment":
            assert d["spec"]["replicas"] == expected_minimum
            pod = d["spec"]["template"]["spec"]
            assert ("topologySpreadConstraints" in pod) == (environment != "dev")
        if d["kind"] == "HorizontalPodAutoscaler":
            assert d["spec"]["minReplicas"] == expected_minimum
        if d["kind"] == "ExternalSecret":
            assert all(item["remoteRef"]["key"].startswith(namespace + "/") for item in d["spec"]["data"])
        if d["kind"] == "ConfigMap" and d["metadata"]["name"] == "api-config":
            assert d["data"]["ASTERIQ_ENVIRONMENT"] == environment
            assert d["data"]["AUTH_WEB_URL"] == "https://REPLACE_" + environment.upper() + "_HOST"
    assert not any(d["kind"] in {"PrometheusRule", "Elasticsearch", "Kibana"} for d in docs)


def test_reusable_base_has_no_environment_identity_or_public_configuration():
    result = subprocess.run(["kubectl", "kustomize", str(ROOT / "k8s/base")],
        capture_output=True, text=True, check=True)
    docs = list(yaml.safe_load_all(result.stdout))
    assert not any(d["kind"] in {"Namespace", "Ingress", "ExternalSecret", "SecretStore"} for d in docs)
    for d in docs:
        if d["kind"] == "Deployment":
            assert "replicas" not in d["spec"]
        if d["kind"] == "ConfigMap" and d["metadata"]["name"].endswith("-config"):
            assert not set(d["data"]).intersection({"ASTERIQ_ENVIRONMENT", "AUTH_WEB_URL", "CORS_ORIGINS", "AUTH_EMAIL_FROM", "APP_ENV", "NODE_ENV"})


def test_legacy_production_entry_point_uses_canonical_configuration(rendered):
    old = subprocess.run(["kubectl", "kustomize", str(ROOT / "infrastructure/kubernetes/overlays/production")],
        capture_output=True, text=True, check=True)
    assert list(yaml.safe_load_all(old.stdout)) == rendered[1]


def test_monitoring_profiles_render_only_resources_not_chart_values():
    for profile in ("prometheus", "grafana", "loki", "elk"):
        result = subprocess.run(["kubectl", "kustomize", str(ROOT / "k8s/monitoring" / profile)],
            capture_output=True, text=True, check=True)
        docs = list(yaml.safe_load_all(result.stdout))
        assert all(d.get("kind") and d.get("apiVersion") for d in docs)
        assert all(d["metadata"]["namespace"] == "monitoring" for d in docs)
