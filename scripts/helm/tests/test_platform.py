"""Verify the umbrella's one-release routing, profiles and bundled dependencies."""
from pathlib import Path
import subprocess
import tarfile
import tempfile

import pytest
import yaml

ROOT=Path(__file__).resolve().parents[3]
PLATFORM=ROOT/"helm/asteriq-platform"
NAMES={"frontend","api","ai-service"}


def helm(*args,check=True):
    return subprocess.run(["helm",*map(str,args)],capture_output=True,text=True,check=check)


def render(environment=None,release="asteriq",extra=()):
    args=["template",release,PLATFORM,"--namespace","asteriq-"+(environment or "dev")]
    if environment:args += ["-f",PLATFORM/f"values-{environment}.yaml"]
    args += list(extra)
    return [d for d in yaml.safe_load_all(helm(*args).stdout) if d]


@pytest.mark.parametrize("environment,minimum",[(None,1),("dev",1),("staging",2),("production",3)])
def test_platform_lint_routing_and_environment_profiles(environment,minimum):
    args=["lint",PLATFORM,"--strict"]
    if environment:args += ["-f",PLATFORM/f"values-{environment}.yaml"]
    helm(*args)
    docs=render(environment)
    deployments={d["metadata"]["name"]:d for d in docs if d["kind"]=="Deployment"}
    services={d["metadata"]["name"]:d for d in docs if d["kind"]=="Service"}
    configs={d["metadata"]["name"]:d["data"] for d in docs if d["kind"]=="ConfigMap"}
    assert set(deployments)==set(services)==NAMES
    assert configs["frontend-config"]["API_UPSTREAM"]=="http://api:3000"
    assert configs["api-config"]["AI_SERVICE_URL"]=="http://ai-service:8000"
    assert configs["ai-service-config"]["RESEARCH_BACKEND_URL"]=="http://api:3000/api/v1"
    for name in NAMES:
        assert configs[name+"-config"]["ASTERIQ_ENVIRONMENT"]==(environment or "dev")
        assert deployments[name]["spec"]["selector"]["matchLabels"]==services[name]["spec"]["selector"]
        assert services[name]["spec"]["selector"]["app.kubernetes.io/instance"]=="asteriq"
    hpas=[d for d in docs if d["kind"]=="HorizontalPodAutoscaler"]
    if environment in (None,"dev"):
        assert not hpas and all(d["spec"]["replicas"]==1 for d in deployments.values())
    else:
        expected_minima = {"frontend": 2, "api": 3, "ai-service": 2} if environment == "production" else dict.fromkeys(NAMES, minimum)
        assert len(hpas)==3 and all(d["spec"]["minReplicas"]==expected_minima[d["metadata"]["name"]] for d in hpas)
        assert all("replicas" not in d["spec"] for d in deployments.values())
    ingress=[d for d in docs if d["kind"]=="Ingress"]
    assert len(ingress)==int(environment in ("staging","production"))
    if ingress:
        assert ingress[0]["spec"]["rules"][0]["http"]["paths"][0]["backend"]["service"]["name"]=="frontend"
    assert not any(d["kind"]=="Secret" for d in docs)


def test_release_rename_preserves_peer_service_names():
    docs=render(release="another-release")
    assert {d["metadata"]["name"] for d in docs if d["kind"]=="Service"}==NAMES
    assert all(d["spec"]["selector"]["matchLabels"]["app.kubernetes.io/instance"]=="another-release"
        for d in docs if d["kind"]=="Deployment")


@pytest.mark.parametrize("dependency,component",[("asteriq-web","frontend"),("asteriq-api","api"),("asteriq-ai-service","ai-service")])
def test_dependency_conditions(dependency,component):
    docs=render(extra=("--set",dependency+".enabled=false"))
    assert {d["metadata"]["name"] for d in docs if d["kind"]=="Deployment"}==NAMES-{component}


def test_local_dependencies_are_locked_and_packaged():
    chart=yaml.safe_load((PLATFORM/"Chart.yaml").read_text())
    lock=yaml.safe_load((PLATFORM/"Chart.lock").read_text())
    assert {d["name"] for d in lock["dependencies"]}=={"asteriq-web","asteriq-api","asteriq-ai-service"}
    assert all(d["repository"]=="file://../"+d["name"] for d in chart["dependencies"])
    runtime=ROOT/".runtime"
    runtime.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=runtime) as directory:
        repositories=Path(directory)/"repositories.yaml"
        repositories.write_text("apiVersion: v1\nrepositories: []\n")
        helm("dependency","build",PLATFORM,"--skip-refresh","--repository-config",repositories)
        helm("package",PLATFORM,"--destination",directory)
        with tarfile.open(next(Path(directory).glob("*.tgz"))) as archive:
            files=set(archive.getnames())
        for dependency in chart["dependencies"]:
            assert "asteriq-platform/charts/"+dependency["name"]+"/Chart.yaml" in files


def test_unknown_environment_is_rejected():
    result=helm("template","asteriq",PLATFORM,"--set","environment=unknown",check=False)
    assert result.returncode!=0
