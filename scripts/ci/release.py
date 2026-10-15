"""Release metadata and GitHub run provenance checks; no cloud credentials are embedded."""
import json
import os
from pathlib import Path
import re
import sys
import urllib.request

SERVICES = {"web", "api", "ai-service"}


def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise ValueError(f"Set {name} before publication/deployment.")
    return value


def registry():
    account, region = required("AWS_ACCOUNT_ID"), required("AWS_REGION")
    if not re.fullmatch(r"\d{12}", account) or not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d", region):
        raise ValueError("Invalid AWS account or region.")
    prefix = os.environ.get("ECR_PREFIX", "asteriq")
    if not re.fullmatch(r"[a-z0-9]+(?:[._/-][a-z0-9]+)*", prefix) or len(prefix) > 200:
        raise ValueError("Use a lowercase ECR repository prefix.")
    return f"{account}.dkr.ecr.{region}.amazonaws.com/{prefix}"


def valid_image(service, image):
    if service not in SERVICES or not isinstance(image, str) or not re.fullmatch(
        re.escape(registry() + "/" + service + "@sha256:") + r"[0-9a-f]{64}", image
    ):
        raise ValueError("Release images must use the configured ECR repository and immutable digest.")


def validate_manifest(data, repository, commit, run_id, attempt):
    if data.get("version") != 1 or data.get("repository") != repository or data.get("commit") != commit:
        raise ValueError("Release identity does not match the verified workflow run.")
    if str(data.get("run_id")) != str(run_id) or str(data.get("run_attempt")) != str(attempt):
        raise ValueError("Release run/attempt does not match.")
    images = data.get("images", {})
    if set(images) != SERVICES:
        raise ValueError("Release must contain exactly web, api, and ai-service.")
    for service, record in images.items():
        valid_image(service, record.get("image"))
        if record.get("platform") != "linux/amd64":
            raise ValueError("Only the scanned linux/amd64 platform is supported.")
    return data


def verify_run(run, repository):
    if (run.get("repository", {}).get("full_name") != repository
            or run.get("head_repository", {}).get("full_name") != repository
            or run.get("head_branch") != "main" or run.get("event") != "push"
            or run.get("status") != "completed" or run.get("conclusion") != "success"
            or run.get("path", "").split("@", 1)[0] != ".github/workflows/main.yml"
            or not re.fullmatch(r"[0-9a-f]{40}", run.get("head_sha", ""))):
        raise ValueError("Only a successful main push from this repository's Main workflow can deploy.")
    return run["head_sha"], run["run_attempt"]


def output(name, value):
    if "\n" in str(value) or "\r" in str(value):
        raise ValueError("Invalid workflow output.")
    with open(required("GITHUB_OUTPUT"), "a", encoding="utf-8") as stream:
        stream.write(f"{name}={value}\n")


def release_identity():
    return {"version": 1, "repository": required("GITHUB_REPOSITORY"),
            "commit": required("GITHUB_SHA"), "run_id": required("GITHUB_RUN_ID"),
            "run_attempt": required("GITHUB_RUN_ATTEMPT")}


def main(command):
    if command == "check-config":
        registry()
    elif command == "write-image":
        service, image = required("SERVICE"), required("IMAGE")
        valid_image(service, image)
        Path(f"release-image-{service}.json").write_text(json.dumps({**release_identity(),
            "service": service, "image": image, "platform": "linux/amd64"}), encoding="utf-8")
    elif command == "assemble":
        data = {**release_identity(), "images": {}}
        for path in Path("release-images").glob("*.json"):
            record = json.loads(path.read_text())
            if any(str(record.get(key)) != str(data[key]) for key in release_identity()):
                raise ValueError("Mixed commits or workflow attempts in image artifacts.")
            service = record.get("service")
            if service in data["images"]:
                raise ValueError("Duplicate service artifact.")
            data["images"][service] = {"image": record.get("image"), "platform": record.get("platform")}
        validate_manifest(data, data["repository"], data["commit"], data["run_id"], data["run_attempt"])
        Path("release.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    elif command == "verify-run":
        run_id, repository = required("RELEASE_RUN_ID"), required("GITHUB_REPOSITORY")
        if not re.fullmatch(r"[1-9]\d*", run_id):
            raise ValueError("Release run ID must be a positive integer.")
        request = urllib.request.Request(
            required("GITHUB_API_URL") + f"/repos/{repository}/actions/runs/{run_id}",
            headers={"Authorization": "Bearer " + required("GH_TOKEN"),
                     "Accept": "application/vnd.github+json", "User-Agent": "asteriq-release"})
        with urllib.request.urlopen(request, timeout=30) as response:
            run = json.load(response)
        commit, attempt = verify_run(run, repository)
        output("commit", commit)
        output("attempt", attempt)
    elif command in {"validate", "image-outputs"}:
        data = json.loads(Path("release/release.json").read_text())
        validate_manifest(data, required("GITHUB_REPOSITORY"), required("EXPECTED_COMMIT")
            if command == "validate" else data["commit"], required("RELEASE_RUN_ID"),
            required("EXPECTED_RUN_ATTEMPT") if command == "validate" else data["run_attempt"])
        if command == "image-outputs":
            for service, record in sorted(data["images"].items()):
                output(service, record["image"])
    else:
        raise ValueError("Unknown release command.")


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception as error:
        # GitHub request headers and credentials must never appear in output.
        print(f"Release validation failed: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
