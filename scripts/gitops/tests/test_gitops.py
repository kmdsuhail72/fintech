import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace

import pytest
import yaml

ROOT=Path(__file__).resolve().parents[3]


def load(name):
    spec=importlib.util.spec_from_file_location("gitops_"+name,ROOT/"scripts/gitops"/(name+".py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


promote=load("promote")
validate=load("validate")


@pytest.fixture
def checkout(monkeypatch):
    runtime=ROOT/".runtime"
    runtime.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=runtime) as temporary:
        root=Path(temporary)/"repo"
        shutil.copytree(ROOT/"gitops",root)
        for environment in ("development","staging","production"):
            app_path=root/"applications"/(environment+".yaml")
            app=yaml.safe_load(app_path.read_text())
            app["spec"]["sources"][0]["repoURL"]="https://github.com/example/asteriq-ai.git"
            app["spec"]["sources"][1]["repoURL"]="https://github.com/example/asteriq-gitops.git"
            app["spec"]["destination"]["server"]="https://"+environment+".eks.example.net"
            app_path.write_text(yaml.safe_dump(app,sort_keys=False))
            project_path=root/"projects"/(environment+".yaml")
            project=yaml.safe_load(project_path.read_text())
            project["spec"]["sourceRepos"]=[s["repoURL"] for s in app["spec"]["sources"]]
            project["spec"]["destinations"]=[app["spec"]["destination"]]
            project_path.write_text(yaml.safe_dump(project,sort_keys=False))
            values_path=root/"environments"/environment/"values.yaml"
            values=values_path.read_text()
            for name in ("DEV","STAGING","PRODUCTION"):
                values=values.replace("REPLACE_"+name+"_HOST","trading.asteriq.test").replace("REPLACE_"+name+"_SES_SENDER","auth@asteriq.test")
            values=values.replace("asteriq.example.com","asteriq.test").replace("REPLACE_ACM_CERTIFICATE_ARN","arn:aws:acm:us-east-1:123456789012:certificate/synthetic")
            values_path.write_text(values)
        monkeypatch.setenv("APP_REPOSITORY","example/asteriq-ai")
        monkeypatch.setenv("EXPECTED_COMMIT","a"*40)
        monkeypatch.setenv("RELEASE_RUN_ID","123")
        monkeypatch.setenv("EXPECTED_RUN_ATTEMPT","1")
        monkeypatch.setenv("AWS_ACCOUNT_ID","123456789012")
        monkeypatch.setenv("AWS_REGION","us-east-1")
        monkeypatch.setenv("ECR_PREFIX","asteriq")
        yield root


@pytest.fixture
def release():
    return {"version":1,"repository":"example/asteriq-ai","commit":"a"*40,"run_id":"123","run_attempt":"1",
        "images":{name:{"image":"123456789012.dkr.ecr.us-east-1.amazonaws.com/asteriq/"+name+"@sha256:"+letter*64,
            "platform":"linux/amd64"} for name,letter in (("web","a"),("api","b"),("ai-service","c"))}}


@pytest.mark.parametrize("environment",["development","staging","production"])
def test_project_sync_controls_and_namespace_isolation(environment):
    app,_=validate.validate_environment(ROOT/"gitops",environment)
    if environment=="production":assert "automated" not in app["spec"]["syncPolicy"]
    else:assert app["spec"]["syncPolicy"]["automated"]["selfHeal"] is True
    validate.validate_composition(ROOT/"gitops")


def test_promote_same_tuple_through_all_environments(checkout,release):
    for environment in ("development","staging","production"):
        files=promote.prepare(checkout,environment,release)
        assert len(files)==3
        app,values=validate.validate_environment(checkout,environment,configured=True)
        assert app["spec"]["sources"][0]["targetRevision"]==release["commit"]
        assert app["spec"]["sources"][1]["targetRevision"].startswith("refs/tags/release/"+environment+"/")
        expected_tag=f"{release['commit']}-{release['run_id']}-{release['run_attempt']}"
        assert all(values[c]["image"]["tag"]==expected_tag for c in promote.CHARTS.values())
        promote.verify_render(ROOT/"helm/asteriq-platform",checkout,environment,release)


def test_skip_promotion_and_mixed_artifacts_are_rejected(checkout,release):
    with pytest.raises(FileNotFoundError):promote.prepare(checkout,"production",release)
    bad=copy.deepcopy(release)
    bad["images"]["api"]["image"]="attacker.example/api:latest"
    with pytest.raises(ValueError):promote.prepare(checkout,"development",bad)


def test_unverified_image_tag_is_rejected(checkout,release):
    promote.prepare(checkout,"development",release)
    path=checkout/"environments/development/values.yaml"
    values=yaml.safe_load(path.read_text())
    values["asteriq-api"]["image"]["tag"]="latest"
    path.write_text(yaml.safe_dump(values))
    with pytest.raises(ValueError,match="tag must match"):
        validate.validate_environment(checkout,"development",configured=True)
    promote.prepare(checkout,"development",release)
    previous=checkout/"environments/development/release.json"
    record=json.loads(previous.read_text())
    record["commit"]="b"*40
    previous.write_text(json.dumps(record))
    with pytest.raises(ValueError,match="exact release"):promote.prepare(checkout,"staging",release)


def test_promotion_preserves_security_controls(checkout,release):
    promote.prepare(checkout,"development",release)
    promote.prepare(checkout,"staging",release)
    before=yaml.safe_load((checkout/"applications/production.yaml").read_text())
    promote.prepare(checkout,"production",release)
    after=yaml.safe_load((checkout/"applications/production.yaml").read_text())
    assert before["spec"]["syncPolicy"]==after["spec"]["syncPolicy"]
    assert before["spec"]["destination"]==after["spec"]["destination"]


@pytest.mark.parametrize("bypass",["auto-sync","rename","helm-parameters","extra-application"])
def test_policy_bypasses_are_rejected(checkout,bypass):
    path=checkout/"applications/production.yaml"
    app=yaml.safe_load(path.read_text())
    if bypass=="auto-sync":app["spec"]["syncPolicy"]["automated"]={"enabled":True}
    elif bypass=="rename":app["metadata"]["name"]="outside-window"
    elif bypass=="helm-parameters":app["spec"]["sources"][0]["helm"]["parameters"]=[{"name":"asteriq-api.image.tag","value":"latest"}]
    else:
        composition=checkout/"applications/kustomization.yaml"
        doc=yaml.safe_load(composition.read_text())
        doc["resources"].append("unreviewed.yaml")
        composition.write_text(yaml.safe_dump(doc))
        with pytest.raises(ValueError):validate.validate_composition(checkout)
        return
    path.write_text(yaml.safe_dump(app))
    with pytest.raises(ValueError):validate.validate_environment(checkout,"production")


def test_pre_sync_hook_uses_api_digest_and_separate_identity(checkout,release):
    promote.prepare(checkout,"development",release)
    values=checkout/"environments/development/values.yaml"
    result=subprocess.run(["helm","template","asteriq",str(ROOT/"helm/asteriq-platform"),"-f",str(values)],
        capture_output=True,text=True,check=True)
    job=next(d for d in yaml.safe_load_all(result.stdout) if d and d["kind"]=="Job")
    assert job["metadata"]["annotations"]["argocd.argoproj.io/hook"]=="PreSync"
    pod=job["spec"]["template"]["spec"]
    assert pod["containers"][0]["image"]==release["images"]["api"]["image"]
    assert pod["containers"][0]["envFrom"]==[{"secretRef":{"name":"migration-secrets"}}]
    assert pod["serviceAccountName"]=="migration" and pod["automountServiceAccountToken"] is False


def test_forward_migration_runner_can_be_retained_for_rollback(checkout,release):
    promote.prepare(checkout,"development",release)
    values_path=checkout/"environments/development/values.yaml"
    values=yaml.safe_load(values_path.read_text())
    newer="sha256:"+"d"*64
    values["migration"]["image"]={"repository":"123456789012.dkr.ecr.us-east-1.amazonaws.com/asteriq/api","digest":newer}
    values_path.write_text(yaml.safe_dump(values))
    result=subprocess.run(["helm","template","asteriq",str(ROOT/"helm/asteriq-platform"),"-f",str(values_path)],
        capture_output=True,text=True,check=True)
    job=next(d for d in yaml.safe_load_all(result.stdout) if d and d["kind"]=="Job")
    assert job["spec"]["template"]["spec"]["containers"][0]["image"].endswith("@"+newer)
    with pytest.raises(ValueError):validate.validate_environment(checkout,"development",configured=True)


def test_path_escape_and_ci_cluster_access_are_blocked(checkout):
    with pytest.raises(ValueError):promote.safe_file(checkout,"../outside.yaml")
    workflow=(ROOT/".github/workflows/gitops-promotion.yml").read_text()
    assert "kubectl" not in workflow and "argocd app sync" not in workflow
    assert "verify-run" in workflow and "workflow_run" in workflow
    assert "--publish-pr" in workflow and "permission-contents: write" in workflow
    assert "OIDC" in workflow and workflow.count("Rescan production") == 3


def test_gitops_seed_validator_is_current():
    assert (ROOT/"scripts/gitops/validate.py").read_text()==(ROOT/"gitops/automation/validate.py").read_text()


@pytest.mark.parametrize("mismatch",[False,True])
def test_immutable_snapshot_matches_actual_argo_values(checkout,release,monkeypatch,mismatch):
    promote.prepare(checkout,"development",release)
    def git_show(command,**kwargs):
        assert command[:2]==["git","show"]
        relative=command[2].split(":",1)[1]
        text=(checkout/relative).read_text()
        if mismatch and relative.endswith("values.yaml"):
            data=yaml.safe_load(text)
            data["asteriq-api"]["image"]["digest"]="sha256:"+"e"*64
            text=yaml.safe_dump(data)
        return SimpleNamespace(stdout=text)
    monkeypatch.setattr(validate.subprocess,"run",git_show)
    if mismatch:
        with pytest.raises(ValueError,match="snapshot tag"):validate.validate_snapshot(checkout,"development")
    else:validate.validate_snapshot(checkout,"development")


def test_repository_allowlist_blocks_changed_sources(checkout):
    with pytest.raises(ValueError,match="allowlist"):
        validate.validate_environment(checkout,"development",app_repository="other/application")
