"""Prepare a reviewable desired-state change; never contacts a cluster or merges PRs."""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import yaml

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"ci"))
from release import validate_manifest

CHARTS={"web":"asteriq-web","api":"asteriq-api","ai-service":"asteriq-ai-service"}
PREVIOUS={"staging":"development","production":"staging"}


def safe_file(root, relative):
    path=(root/relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("GitOps file must remain inside the checkout.")
    return path


def candidate_identity(data):
    return {key:data[key] for key in ("repository","commit","run_id","run_attempt","images")}


def revision_tag(environment,data):
    return f"release/{environment}/{data['commit']}-{data['run_id']}-{data['run_attempt']}"


def update_values(values,data):
    updated=copy.deepcopy(values)
    for service,chart in CHARTS.items():
        repository,digest=data["images"][service]["image"].rsplit("@",1)
        tag=f"{data['commit']}-{data['run_id']}-{data['run_attempt']}"
        updated.setdefault(chart,{})["image"]={"repository":repository,"tag":tag,"digest":digest}
        updated[chart]["enabled"]=True
    updated.setdefault("migration",{})["enabled"]=True
    updated["migration"]["image"]={"repository":"","digest":""}
    return updated


def prepare(root,environment,data):
    if environment not in {"development","staging","production"}:
        raise ValueError("Unknown deployment environment.")
    validate_manifest(data,os.environ["APP_REPOSITORY"],os.environ["EXPECTED_COMMIT"],
        os.environ["RELEASE_RUN_ID"],os.environ["EXPECTED_RUN_ATTEMPT"])
    if environment in PREVIOUS:
        previous=PREVIOUS[environment]
        source=json.loads(safe_file(root,f"environments/{previous}/release.json").read_text())
        if candidate_identity(source)!=candidate_identity(data):
            raise ValueError("Promote the exact release currently approved in the preceding environment.")
        source_app=yaml.safe_load(safe_file(root,f"applications/{previous}.yaml").read_text())
        if source_app["spec"]["sources"][0]["targetRevision"]!=source["commit"] or source_app["spec"]["sources"][1]["targetRevision"]!=source["promotion"]["gitops_revision"]:
            raise ValueError("Source environment application pins disagree with its release record.")
        source_values=yaml.safe_load(safe_file(root,f"environments/{previous}/values.yaml").read_text())
        for service,chart in CHARTS.items():
            image=source_values[chart]["image"]
            if image["repository"]+"@"+image["digest"]!=data["images"][service]["image"]:
                raise ValueError("Source environment values disagree with its release record.")
    app_path=safe_file(root,f"applications/{environment}.yaml")
    values_path=safe_file(root,f"environments/{environment}/values.yaml")
    app=yaml.safe_load(app_path.read_text())
    sources=app["spec"]["sources"]
    expected_url="https://github.com/"+data["repository"]+".git"
    if sources[0]["repoURL"]!=expected_url or sources[0]["path"]!="helm/asteriq-platform":
        raise ValueError("Application must use the verified source repository and umbrella chart.")
    if "REPLACE" in app["spec"]["destination"]["server"] or "REPLACE" in sources[1]["repoURL"]:
        raise ValueError("Configure GitOps repository and EKS destinations before promotion.")
    values=update_values(yaml.safe_load(values_path.read_text()),data)
    if "REPLACE" in yaml.safe_dump(values) or "example.com" in yaml.safe_dump(values):
        raise ValueError("Configure environment hostnames, sender, TLS and runtime settings before promotion.")
    sources[0]["targetRevision"]=data["commit"]
    sources[1]["targetRevision"]="refs/tags/"+revision_tag(environment,data)
    record={**data,"promotion":{"environment":environment,"from":PREVIOUS.get(environment,"successful-main"),
        "gitops_revision":"refs/tags/"+revision_tag(environment,data)}}
    # Only chart revision, image desired state and release provenance are changed.
    app_path.write_text(yaml.safe_dump(app,sort_keys=False))
    values_path.write_text(yaml.safe_dump(values,sort_keys=False))
    safe_file(root,f"environments/{environment}/release.json").write_text(json.dumps(record,indent=2)+"\n")
    return [f"applications/{environment}.yaml",f"environments/{environment}/values.yaml",f"environments/{environment}/release.json"]


def publish(root,environment,data,files):
    root=root.resolve()
    repository=os.environ["GITOPS_REPOSITORY"]
    if not re.fullmatch(r"[\w.-]+/[\w.-]+",repository):
        raise ValueError("Use owner/repository for the GitOps destination.")
    base=os.environ.get("GITOPS_BRANCH","main")
    branch=f"promote/{environment}/{data['commit'][:12]}-{data['run_id']}-{data['run_attempt']}"
    def run(*args):
        subprocess.run(args,cwd=root,check=True)
    run("git","config","user.name","asteriq-gitops[bot]")
    run("git","config","user.email","asteriq-gitops@users.noreply.github.com")
    run("git","checkout","-b",branch)
    run("git","add","--",*files)
    result=subprocess.run(["git","diff","--cached","--quiet"],cwd=root,check=False)
    if result.returncode==0:
        print("Desired release already matches; no PR required.")
        return
    if result.returncode!=1:raise RuntimeError("Cannot inspect staged GitOps change.")
    run("git","commit","-m",f"Promote {environment}: {data['commit'][:12]}")
    tag=revision_tag(environment,data)
    run("git","tag",tag)
    run("git","push","origin","HEAD:refs/heads/"+branch)
    run("git","push","origin","refs/tags/"+tag)
    body=root/".git"/"asteriq-pr-body.md"
    body.write_text(f"Promote the verified Main release `{data['commit']}` to {environment}.\n\n"
        f"Source workflow run: {data['run_id']} (attempt {data['run_attempt']}).\n"
        "All three scanned linux/amd64 images are pinned by ECR digest.\n"
        "Migration PreSync uses the same API digest and separate credentials.\n"
        "Confirm preceding-environment health and test evidence before approval.\n")
    run("gh","pr","create","--repo",repository,"--base",base,"--head",branch,
        "--title",f"Promote {environment}: {data['commit'][:12]}","--body-file",str(body))


def verify_render(chart,root,environment,data):
    profile="dev" if environment=="development" else environment
    values=safe_file(root,f"environments/{environment}/values.yaml")
    base=chart/f"values-{profile}.yaml"
    subprocess.run(["helm","lint",str(chart),"--strict","-f",str(base),"-f",str(values)],check=True)
    result=subprocess.run(["helm","template","asteriq",str(chart),"-f",str(base),"-f",str(values)],
        capture_output=True,text=True,check=True)
    docs=[d for d in yaml.safe_load_all(result.stdout) if d]
    images={d["spec"]["template"]["spec"]["containers"][0]["image"] for d in docs if d["kind"]=="Deployment"}
    if images!={record["image"] for record in data["images"].values()}:
        raise ValueError("Rendered deployments must use exactly the verified release images.")
    jobs=[d for d in docs if d["kind"]=="Job" and d["metadata"].get("annotations",{}).get("argocd.argoproj.io/hook")=="PreSync"]
    if len(jobs)!=1 or jobs[0]["spec"]["template"]["spec"]["containers"][0]["image"]!=data["images"]["api"]["image"]:
        raise ValueError("Require one migration PreSync hook using the promoted API digest.")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout",type=Path,required=True)
    parser.add_argument("--environment",choices=["development","staging","production"],required=True)
    parser.add_argument("--release",type=Path,required=True)
    parser.add_argument("--publish-pr",action="store_true")
    parser.add_argument("--chart",type=Path,help="Verified source revision's umbrella chart")
    args=parser.parse_args()
    try:
        data=json.loads(args.release.read_text())
        files=prepare(args.checkout,args.environment,data)
        if args.chart:verify_render(args.chart,args.checkout,args.environment,data)
        if args.publish_pr:
            if not args.chart:raise ValueError("Validate the verified source chart before publishing a PR.")
            publish(args.checkout,args.environment,data,files)
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as error:
        print(f"GitOps promotion halted: {error}",file=sys.stderr)
        sys.exit(1)
