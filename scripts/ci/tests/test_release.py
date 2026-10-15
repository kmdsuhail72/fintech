"""Exercise the release trust boundary without network or AWS credentials."""
import copy
import importlib.util
from pathlib import Path
import sys

import pytest


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


release = load_module("release")
ecs = load_module("deploy_ecs")


@pytest.fixture
def manifest(monkeypatch):
    monkeypatch.setenv("AWS_ACCOUNT_ID", "123456789012")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("ECR_PREFIX", "asteriq")
    return {
        "version": 1, "repository": "example/asteriq", "commit": "a" * 40,
        "run_id": "123", "run_attempt": "1",
        "images": {service: {
            "image": f"{release.registry()}/{service}@sha256:{'b' * 64}",
            "platform": "linux/amd64",
        } for service in release.SERVICES},
    }


def validate(data):
    return release.validate_manifest(data, "example/asteriq", "a" * 40, "123", "1")


def test_valid_manifest(manifest):
    assert validate(manifest) == manifest


@pytest.mark.parametrize("field,value", [
    ("repository", "attacker/asteriq"), ("commit", "c" * 40),
    ("run_id", "124"), ("run_attempt", "2"), ("version", 2),
])
def test_reject_mixed_release_identity(manifest, field, value):
    manifest[field] = value
    with pytest.raises(ValueError):
        validate(manifest)


@pytest.mark.parametrize("image", [
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/asteriq/web:latest",
    f"999999999999.dkr.ecr.us-east-1.amazonaws.com/asteriq/web@sha256:{'b' * 64}",
    f"123456789012.dkr.ecr.us-east-1.amazonaws.com/asteriq/api@sha256:{'b' * 64}",
])
def test_reject_mutable_or_wrong_repository_image(manifest, image):
    manifest["images"]["web"]["image"] = image
    with pytest.raises(ValueError):
        validate(manifest)


def test_reject_incomplete_release(manifest):
    del manifest["images"]["api"]
    with pytest.raises(ValueError):
        validate(manifest)


def trusted_run():
    return {"repository": {"full_name": "example/asteriq"},
            "head_repository": {"full_name": "example/asteriq"},
            "head_branch": "main", "event": "push", "status": "completed",
            "conclusion": "success", "path": ".github/workflows/main.yml",
            "head_sha": "a" * 40, "run_attempt": 1}


def test_successful_main_run():
    assert release.verify_run(trusted_run(), "example/asteriq") == ("a" * 40, 1)


@pytest.mark.parametrize("field,value", [
    ("event", "pull_request"), ("conclusion", "failure"),
    ("head_branch", "feature"), ("status", "in_progress"),
    ("path", ".github/workflows/other.yml"),
    ("head_repository", {"full_name": "attacker/asteriq"}),
])
def test_reject_untrusted_workflow_run(field, value):
    run = trusted_run()
    run[field] = value
    with pytest.raises(ValueError):
        release.verify_run(run, "example/asteriq")


def test_task_update_preserves_secrets_and_disables_startup_migration(manifest):
    original = {"family": "api", "requiresCompatibilities": ["FARGATE"],
                "taskDefinitionArn": "read-only-response-field",
                "containerDefinitions": [{"name": "api", "image": "old",
                    "secrets": [{"name": "DATABASE_URL", "valueFrom": "secret-arn"}],
                    "environment": [{"name": "RUN_MIGRATIONS", "value": "true"}]}]}
    snapshot = copy.deepcopy(original)
    updated = ecs.prepare_definition(original, "api", manifest["images"]["api"]["image"], "api")
    assert original == snapshot
    assert "taskDefinitionArn" not in updated
    assert updated["containerDefinitions"][0]["secrets"] == original["containerDefinitions"][0]["secrets"]
    assert updated["containerDefinitions"][0]["environment"] == [{"name": "RUN_MIGRATIONS", "value": "false"}]


def test_detect_ecs_automatic_rollback():
    with pytest.raises(RuntimeError):
        ecs.ensure_rollout({"taskDefinition": "old", "runningCount": 1, "desiredCount": 1,
            "deployments": [{"status": "PRIMARY", "taskDefinition": "old", "rolloutState": "COMPLETED"}]}, "new")


@pytest.mark.parametrize("reuse_secret", [False, True])
def test_migration_identity_isolation_before_rollout(manifest, monkeypatch, tmp_path, reuse_secret):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ECS_CLUSTER", "test-cluster")
    monkeypatch.setenv("ECS_MIGRATION_TASK_DEFINITION", "migration")
    for name in ("WEB", "API", "AI"):
        monkeypatch.setenv(f"ECS_{name}_SERVICE", name.lower())
    revisions, run_tasks, updated = {}, [], []

    def call(operation, *args, payload=None):
        if operation == "describe-services":
            name = args[args.index("--services") + 1]
            task = revisions.get(name, name)
            return {"services": [{"taskDefinition": task, "desiredCount": 1, "runningCount": 1,
                "networkConfiguration": {"awsvpcConfiguration": {"subnets": ["private"], "securityGroups": ["api"]}},
                "deployments": [{"status": "PRIMARY", "taskDefinition": task, "rolloutState": "COMPLETED"}]}]}
        if operation == "describe-task-definition":
            family = args[args.index("--task-definition") + 1]
            name = {"ai": "ai-service", "migration": "api"}.get(family, family)
            secret = "runtime-db" if family != "migration" or reuse_secret else "migration-db"
            return {"taskDefinition": {"family": family, "requiresCompatibilities": ["FARGATE"],
                "taskRoleArn": family + "-task", "executionRoleArn": family + "-execution",
                "containerDefinitions": [{"name": name, "image": "previous", "secrets": [
                    {"name": "DATABASE_URL", "valueFrom": secret}]}]}}
        if operation == "register-task-definition":
            return {"taskDefinition": {"taskDefinitionArn": payload["family"] + "-new"}}
        if operation == "run-task":
            run_tasks.append(payload)
            return {"tasks": [{"taskArn": "migration-run"}]}
        if operation == "describe-tasks":
            return {"tasks": [{"containers": [{"name": "api", "exitCode": 0}]}]}
        if operation == "update-service":
            name = args[args.index("--service") + 1]
            revisions[name] = args[args.index("--task-definition") + 1]
            updated.append(name)
        return {}

    if reuse_secret:
        with pytest.raises(ValueError, match="separate database secret"):
            ecs.deploy(manifest, call)
        assert run_tasks == [] and updated == []
    else:
        assert ecs.deploy(manifest, call)["status"] == "success"
        assert run_tasks[0]["taskDefinition"] == "migration-new"
        assert updated == ["ai", "api", "web"]
