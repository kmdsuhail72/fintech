"""Render charts with the real Helm engine and verify application wiring."""
from pathlib import Path
import subprocess
import tarfile
import tempfile

import pytest
import yaml

ROOT=Path(__file__).resolve().parents[3]
CHARTS={"asteriq-web":"frontend","asteriq-api":"api","asteriq-ai-service":"ai-service"}


def run_helm(*args, check=True):
    return subprocess.run(["helm",*map(str,args)],capture_output=True,text=True,check=check)


def render(chart, environment=None, overrides=()):
    args=["template","test-release",ROOT/"helm"/chart,"--namespace","asteriq-"+(environment or "test")]
    if environment:
        args += ["-f",ROOT/"helm"/chart/f"values-{environment}.yaml"]
    for value in overrides:
        args += ["--set-string" if value.startswith("env.") else "--set",value]
    result=run_helm(*args)
    return [d for d in yaml.safe_load_all(result.stdout) if d]


@pytest.mark.parametrize("chart",CHARTS)
@pytest.mark.parametrize("environment",[None,"dev","staging","production"])
def test_lint_and_render_each_profile(chart,environment):
    args=["lint",ROOT/"helm"/chart,"--strict"]
    if environment: args += ["-f",ROOT/"helm"/chart/f"values-{environment}.yaml"]
    run_helm(*args)
    docs=render(chart,environment)
    deployment=next(d for d in docs if d["kind"]=="Deployment")
    service=next(d for d in docs if d["kind"]=="Service")
    selector=deployment["spec"]["selector"]["matchLabels"]
    assert service["spec"]["selector"] == selector
    assert deployment["spec"]["template"]["metadata"]["labels"] == selector
    assert selector["app.kubernetes.io/name"] == CHARTS[chart]
    assert selector["app.kubernetes.io/instance"] == "test-release"
    pod=deployment["spec"]["template"]["spec"]
    container=pod["containers"][0]
    assert pod["automountServiceAccountToken"] is False
    assert pod["securityContext"]["runAsNonRoot"] is True
    assert container["securityContext"]["readOnlyRootFilesystem"] is True
    assert service["spec"]["ports"][0]["targetPort"] == container["ports"][0]["name"]
    maps={d["metadata"]["name"] for d in docs if d["kind"]=="ConfigMap"}
    assert container["envFrom"][0]["configMapRef"]["name"] in maps
    assert not any(d["kind"]=="Secret" for d in docs)
    hpas=[d for d in docs if d["kind"]=="HorizontalPodAutoscaler"]
    if environment=="dev":
        assert not hpas and deployment["spec"]["replicas"]==1
    else:
        assert len(hpas)==1 and "replicas" not in deployment["spec"]
        assert hpas[0]["spec"]["scaleTargetRef"]["name"]==deployment["metadata"]["name"]
    ingresses=[d for d in docs if d["kind"]=="Ingress"]
    assert bool(ingresses)==(chart=="asteriq-web" and environment in ("staging","production"))
    if ingresses:
        backend=ingresses[0]["spec"]["rules"][0]["http"]["paths"][0]["backend"]["service"]
        assert backend["name"]==service["metadata"]["name"]
        assert backend["port"]["number"]==service["spec"]["ports"][0]["port"]


@pytest.mark.parametrize("chart",CHARTS)
def test_custom_ports_digest_and_disabled_optional_resources(chart):
    digest="sha256:"+"a"*64
    docs=render(chart,overrides=("service.port=9000","service.containerPort=9001",
        "image.repository=registry.example/asteriq","image.tag=ignored","image.digest="+digest,
        "autoscaling.enabled=false","replicaCount=4","pdb.enabled=false","serviceAccount.create=false",
        "serviceAccount.name=existing-account","probes.startup.enabled=false"))
    dep=next(d for d in docs if d["kind"]=="Deployment")
    pod=dep["spec"]["template"]["spec"]
    c=pod["containers"][0]
    assert c["image"]=="registry.example/asteriq@"+digest
    assert c["ports"][0]["containerPort"]==9001
    assert pod["serviceAccountName"]=="existing-account"
    assert dep["spec"]["replicas"]==4 and "startupProbe" not in c
    assert not any(d["kind"] in {"HorizontalPodAutoscaler","PodDisruptionBudget","ServiceAccount"} for d in docs)
    config=next(d for d in docs if d["kind"]=="ConfigMap" and d["metadata"]["name"].endswith("-config"))
    if chart=="asteriq-api": assert config["data"]["API_PORT"]=="9001"
    if chart=="asteriq-ai-service": assert "9001" in c["args"]
    if chart=="asteriq-web":
        nginx=next(d for d in docs if d["kind"]=="ConfigMap" and d["metadata"]["name"].endswith("-nginx"))
        assert "listen 9001;" in nginx["data"]["nginx.conf.template"]


@pytest.mark.parametrize("chart",CHARTS)
def test_config_checksum_changes_without_changing_selectors(chart):
    before=next(d for d in render(chart) if d["kind"]=="Deployment")
    after=next(d for d in render(chart,overrides=("env.OBSERVABILITY_ENABLED=false",)) if d["kind"]=="Deployment")
    assert before["spec"]["selector"]==after["spec"]["selector"]
    assert before["spec"]["template"]["metadata"]["annotations"]["checksum/config"] != after["spec"]["template"]["metadata"]["annotations"]["checksum/config"]


@pytest.mark.parametrize("chart",CHARTS)
@pytest.mark.parametrize("setting",["service.containerPort=80","image.digest=sha256:invalid","autoscaling.minReplicas=10,autoscaling.maxReplicas=2","env.OPENAI_API_KEY=do-not-store-secrets-in-values"])
def test_invalid_settings_are_rejected(chart,setting):
    result=run_helm("template","test-release",ROOT/"helm"/chart,"--set",setting,check=False)
    assert result.returncode != 0


@pytest.mark.parametrize("chart",CHARTS)
def test_optional_ingress_uses_custom_port_and_existing_tls_secret(chart):
    docs=render(chart,overrides=("ingress.enabled=true","ingress.className=nginx", "service.port=9000",
        "ingress.hosts[0].host=trading.example.net", "ingress.hosts[0].paths[0].path=/", "ingress.hosts[0].paths[0].pathType=Prefix",
        "ingress.tls[0].hosts[0]=trading.example.net", "ingress.tls[0].secretName=existing-tls"))
    ingress=next(d for d in docs if d["kind"]=="Ingress")
    service=next(d for d in docs if d["kind"]=="Service")
    backend=ingress["spec"]["rules"][0]["http"]["paths"][0]["backend"]["service"]
    assert backend=={"name":service["metadata"]["name"],"port":{"number":9000}}
    assert ingress["spec"]["tls"][0]["secretName"]=="existing-tls"


@pytest.mark.parametrize("chart",["asteriq-api","asteriq-ai-service"])
def test_rds_trust_mount_uses_existing_configmap(chart):
    docs=render(chart,overrides=("rdsCa.enabled=true","rdsCa.existingConfigMap=custom-ca",))
    pod=next(d for d in docs if d["kind"]=="Deployment")["spec"]["template"]["spec"]
    volume=next(v for v in pod["volumes"] if v["name"]=="rds-ca")
    assert volume["configMap"]["name"]=="custom-ca"
    assert any(m["mountPath"]=="/etc/rds-ca" and m["readOnly"] for m in pod["containers"][0]["volumeMounts"])


@pytest.mark.parametrize("chart",CHARTS)
def test_chart_can_package_without_remote_dependencies(chart):
    runtime=ROOT/".runtime"
    runtime.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=runtime) as directory:
        run_helm("package", ROOT/"helm"/chart, "--destination", directory)
        package=next(Path(directory).glob("*.tgz"))
        with tarfile.open(package) as archive:
            files=set(archive.getnames())
        for file in ("Chart.yaml","values.yaml","values.schema.json","values-dev.yaml","values-staging.yaml","values-production.yaml",
            "templates/deployment.yaml","templates/service.yaml","templates/ingress.yaml","templates/configmap.yaml",
            "templates/serviceaccount.yaml","templates/hpa.yaml","templates/pdb.yaml"):
            assert chart+"/"+file in files
