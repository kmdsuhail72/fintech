"""Validate GitOps environment records and restrictive Argo configuration offline."""
import json
from pathlib import Path
import re
import subprocess

import yaml

CHARTS={"web":"asteriq-web","api":"asteriq-api","ai-service":"asteriq-ai-service"}


def validate_environment(root,environment,configured=False,app_repository=None,gitops_repository=None):
    app=yaml.safe_load((root/"applications"/(environment+".yaml")).read_text())
    project=yaml.safe_load((root/"projects"/(environment+".yaml")).read_text())
    values=yaml.safe_load((root/"environments"/environment/"values.yaml").read_text())
    name="asteriq-"+environment
    profile="dev" if environment=="development" else environment
    if app["metadata"]["name"]!=name or app["metadata"].get("namespace")!="argocd" or project["metadata"].get("namespace")!="argocd":
        raise ValueError("Application identity must match the protected environment and control-plane namespace.")
    if app["spec"]["project"]!=name or project["metadata"]["name"]!=name:
        raise ValueError("An application must use its environment-specific project.")
    if app["spec"]["destination"] not in project["spec"]["destinations"]:
        raise ValueError("Destination must be explicitly allowed by its project.")
    if app["spec"]["destination"]["namespace"]!="asteriq-"+profile:
        raise ValueError("Namespaces must be isolated by environment.")
    sources=app["spec"]["sources"]
    if len(sources)!=2:raise ValueError("Exactly two pinned application/value sources are required.")
    for repository,source in ((app_repository,sources[0]),(gitops_repository,sources[1])):
        if repository and source["repoURL"]!="https://github.com/"+repository+".git":
            raise ValueError("Sources must match the configured repository allowlist.")
    if set(sources[0])!={"repoURL","targetRevision","path","helm"} or set(sources[1])!={"repoURL","targetRevision","ref"}:
        raise ValueError("Do not add unreviewed manifest sources or render paths.")
    if set(sources[0]["helm"])!={"releaseName","valueFiles"} or sources[1]["ref"]!="values":
        raise ValueError("Inline Helm overrides must not bypass recorded image values.")
    if len(sources)!=2 or any(s["repoURL"] not in project["spec"]["sourceRepos"] for s in sources):
        raise ValueError("Only the allowlisted application/GitOps sources are permitted.")
    if sources[0]["path"]!="helm/asteriq-platform" or sources[0]["helm"]["releaseName"]!="asteriq":
        raise ValueError("Use the approved umbrella chart and stable Helm selector identity.")
    if sources[0]["helm"]["valueFiles"]!=[f"values-{profile}.yaml",f"$values/environments/{environment}/values.yaml"]:
        raise ValueError("Values files must match the environment.")
    if project["spec"]["clusterResourceWhitelist"]:
        raise ValueError("Application projects must not manage cluster-scoped resources.")
    kinds={(r["group"],r["kind"]) for r in project["spec"]["namespaceResourceWhitelist"]}
    allowed={("apps","Deployment"),("","Service"),("","ConfigMap"),("","ServiceAccount"),
        ("autoscaling","HorizontalPodAutoscaler"),("policy","PodDisruptionBudget"),("networking.k8s.io","Ingress"),("batch","Job")}
    if kinds!=allowed:raise ValueError("Resource permissions must remain least privilege.")
    policy=app["spec"]["syncPolicy"]
    if environment=="production":
        if "automated" in policy:raise ValueError("Production workload synchronization must remain manual.")
        windows=project["spec"].get("syncWindows",[])
        if len(windows)!=1 or windows[0]["kind"]!="allow" or windows[0]["manualSync"] or windows[0]["applications"]!=[name]:
            raise ValueError("Production requires a release window without manual bypass.")
    elif policy.get("automated")!={"enabled":True,"prune":True,"selfHeal":True,"allowEmpty":False}:
        raise ValueError("Development/staging require bounded automated synchronization.")
    if values["environment"]!=profile or values.get("migration",{}).get("enabled") is not True:
        raise ValueError("Enable the migration gate for the matching environment.")
    for chart in CHARTS.values():
        if values[chart].get("enabled") is not True:raise ValueError("A release must contain all three application components.")
    if configured:
        record=json.loads((root/"environments"/environment/"release.json").read_text())
        if sources[0]["repoURL"]!="https://github.com/"+record["repository"]+".git":
            raise ValueError("Source repository must match release provenance.")
        if not re.fullmatch(r"[0-9a-f]{40}",record["commit"]) or sources[0]["targetRevision"]!=record["commit"]:
            raise ValueError("Chart source must match the recorded immutable application commit.")
        if sources[1]["targetRevision"]!=record["promotion"]["gitops_revision"] or not sources[1]["targetRevision"].startswith("refs/tags/release/"+environment+"/"):
            raise ValueError("Values must use the recorded immutable environment tag.")
        for service,chart in CHARTS.items():
            image=values[chart]["image"]
            uri=image["repository"]+"@"+image["digest"]
            if uri!=record["images"][service]["image"] or not re.fullmatch(r"\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9./_-]+@sha256:[0-9a-f]{64}",uri):
                raise ValueError("Release records and all ECR digests must agree.")
            expected_tag=f"{record['commit']}-{record['run_id']}-{record['run_attempt']}"
            if image.get("tag") not in (None,"",expected_tag):
                raise ValueError("Image tag must match the verified release provenance; deployment requires its digest.")
        runner=values["migration"].get("image",{})
        if runner.get("digest"):
            runner_image=runner.get("repository","")+"@"+runner["digest"]
            if record["promotion"].get("action")!="rollback" or record["promotion"].get("migration_image")!=runner_image:
                raise ValueError("An independent migration runner requires an explicitly reviewed rollback record.")
            if runner.get("repository")!=record["images"]["api"]["image"].rsplit("@",1)[0]:
                raise ValueError("Rollback migration runners must come from the approved API repository.")
    return app,values


def validate_composition(root):
    composition=yaml.safe_load((root/"applications/kustomization.yaml").read_text())
    if set(composition)!={"apiVersion","kind","resources"} or set(composition["resources"])!={"development.yaml","staging.yaml","production.yaml"}:
        raise ValueError("The privileged app-of-apps composition must contain only the three reviewed applications.")


def validate_snapshot(root,environment):
    """Compare candidate files with the exact immutable tag Argo will actually read."""
    app,values=validate_environment(root,environment,configured=True)
    record=json.loads((root/"environments"/environment/"release.json").read_text())
    reference=record["promotion"]["gitops_revision"]
    for relative,expected,parser in [
        (f"applications/{environment}.yaml",app,yaml.safe_load),
        (f"environments/{environment}/values.yaml",values,yaml.safe_load),
        (f"environments/{environment}/release.json",record,json.loads)]:
        result=subprocess.run(["git","show",reference+":"+relative],cwd=root,
            capture_output=True,text=True,check=True)
        if parser(result.stdout)!=expected:
            raise ValueError("Candidate files disagree with the immutable GitOps snapshot tag.")


if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",type=Path,required=True)
    parser.add_argument("--configured",action="store_true")
    parser.add_argument("--initialized",action="store_true",help="Require records only for already-promoted environments")
    parser.add_argument("--verify-tags",action="store_true")
    parser.add_argument("--app-repository")
    parser.add_argument("--gitops-repository")
    args=parser.parse_args()
    if args.app_repository=="" or args.gitops_repository=="":
        raise SystemExit("Set repository allowlist variables before enabling GitOps PR validation.")
    validate_composition(args.root)
    for environment in ("development","staging","production"):
        configured=args.configured or (args.initialized and (args.root/"environments"/environment/"release.json").exists())
        validate_environment(args.root,environment,configured,args.app_repository,args.gitops_repository)
        if configured and args.verify_tags:validate_snapshot(args.root,environment)
    print("GitOps environment policies validated")
