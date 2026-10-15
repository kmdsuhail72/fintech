"""Deploy an already validated digest manifest to existing ECS/Fargate services."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from release import required, valid_image, SERVICES

REGISTER_FIELDS = {
    "family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions",
    "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory", "tags",
    "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators", "ephemeralStorage",
    "runtimePlatform", "enableFaultInjection",
}


def aws(*args, payload=None):
    command = ["aws", "ecs", *args]
    with tempfile.TemporaryDirectory() as directory:
        if payload is not None:
            file = Path(directory) / "request.json"
            file.write_text(json.dumps(payload), encoding="utf-8")
            command += ["--cli-input-json", "file://" + str(file)]
        result = subprocess.run(command + ["--output", "json", "--no-cli-pager"],
            capture_output=True, text=True, timeout=900, check=False)
        if result.returncode:
            # Provider errors can contain task environment values; keep logs generic.
            raise RuntimeError(f"AWS ECS {args[0]} failed. Inspect ECS events and CloudWatch logs.")
        return json.loads(result.stdout) if result.stdout.strip() else {}


def prepare_definition(definition, name, image, service):
    if "FARGATE" not in definition.get("requiresCompatibilities", []):
        raise ValueError("Deployment expects existing Fargate task definitions.")
    if definition.get("runtimePlatform", {}).get("cpuArchitecture", "X86_64") != "X86_64":
        raise ValueError("Task architecture must match the scanned linux/amd64 image.")
    task = {key: copy.deepcopy(value) for key, value in definition.items() if key in REGISTER_FIELDS}
    containers = [container for container in task["containerDefinitions"] if container["name"] == name]
    if len(containers) != 1:
        raise ValueError("Configured application container is not unique in the task definition.")
    containers[0]["image"] = image
    if service == "api":
        environment = [item for item in containers[0].get("environment", []) if item["name"] != "RUN_MIGRATIONS"]
        containers[0]["environment"] = environment + [{"name": "RUN_MIGRATIONS", "value": "false"}]
    return task


def ensure_rollout(service, expected):
    deployments = service.get("deployments", [])
    primary = [deployment for deployment in deployments if deployment.get("status") == "PRIMARY"]
    if (service.get("taskDefinition") != expected or len(primary) != 1
            or primary[0].get("taskDefinition") != expected
            or primary[0].get("rolloutState") != "COMPLETED"
            or service.get("runningCount", 0) < service.get("desiredCount", 1)):
        raise RuntimeError("Service did not complete the requested release; it may have rolled back.")


def deploy(data, call=aws):
    if set(data.get("images", {})) != SERVICES:
        raise ValueError("Incomplete release manifest.")
    for service, record in data["images"].items():
        valid_image(service, record["image"])
    cluster = required("ECS_CLUSTER")
    migration_definition = required("ECS_MIGRATION_TASK_DEFINITION")
    names = {"web": required("ECS_WEB_SERVICE"), "api": required("ECS_API_SERVICE"),
             "ai-service": required("ECS_AI_SERVICE")}
    containers = {"web": os.environ.get("ECS_WEB_CONTAINER", "web"),
                  "api": os.environ.get("ECS_API_CONTAINER", "api"),
                  "ai-service": os.environ.get("ECS_AI_CONTAINER", "ai-service")}
    if len(set(names.values())) != 3:
        raise ValueError("Configure three distinct ECS services.")
    previous, definitions, registered, changed = {}, {}, {}, []
    runtime_api_task = None
    migration_pending = False
    result = {"commit": data["commit"], "previous": previous, "deployed": registered, "status": "preparing"}
    try:
        for service, name in names.items():
            response = call("describe-services", "--cluster", cluster, "--services", name)
            if response.get("failures") or len(response.get("services", [])) != 1:
                raise ValueError("Configured ECS service is unavailable.")
            existing = response["services"][0]
            if (existing.get("deploymentController", {}).get("type", "ECS") != "ECS"
                    or existing.get("desiredCount", 0) < 1
                    or "awsvpcConfiguration" not in existing.get("networkConfiguration", {})):
                raise ValueError("Services must use ECS rolling deployment, awsvpc, and a positive desired count.")
            previous[service] = existing["taskDefinition"]
            definitions[service] = existing
            definition = call("describe-task-definition", "--task-definition", previous[service], "--include", "TAGS")
            task = definition["taskDefinition"]
            if service == "api":
                runtime_api_task = copy.deepcopy(task)
            task["tags"] = definition.get("tags", [])
            updated = prepare_definition(task, containers[service], data["images"][service]["image"], service)
            registered[service] = call("register-task-definition", payload=updated)["taskDefinition"]["taskDefinitionArn"]

        # Migration has its own database secret and IAM identities, never runtime DDL rights.
        response = call("describe-task-definition", "--task-definition", migration_definition)
        migration_task = prepare_definition(response["taskDefinition"], "api", data["images"]["api"]["image"], "api")
        runtime_container = next(c for c in runtime_api_task["containerDefinitions"] if c["name"] == containers["api"])
        migration_container = next(c for c in migration_task["containerDefinitions"] if c["name"] == "api")
        runtime_secret = next((s["valueFrom"] for s in runtime_container.get("secrets", []) if s["name"] == "DATABASE_URL"), None)
        migration_secret = next((s["valueFrom"] for s in migration_container.get("secrets", []) if s["name"] == "DATABASE_URL"), None)
        if (not runtime_secret or not migration_secret or runtime_secret == migration_secret
                or not migration_task.get("taskRoleArn") or not migration_task.get("executionRoleArn")
                or migration_task.get("taskRoleArn") == runtime_api_task.get("taskRoleArn")
                or migration_task.get("executionRoleArn") == runtime_api_task.get("executionRoleArn")
                or len(migration_task["containerDefinitions"]) != 1):
            raise ValueError("Migration requires a separate database secret, task role and execution role.")
        migration_container.pop("healthCheck", None)
        migration_container["command"] = ["node", "/workspace/scripts/migrate.mjs"]
        migration_revision = call("register-task-definition", payload=migration_task)["taskDefinition"]["taskDefinitionArn"]
        migration = call("run-task", payload={"cluster": cluster, "taskDefinition": migration_revision,
            "launchType": "FARGATE", "count": 1, "startedBy": "asteriq-migration",
            "networkConfiguration": definitions["api"]["networkConfiguration"],
            "overrides": {"containerOverrides": [{"name": "api",
                "command": ["node", "/workspace/scripts/migrate.mjs"],
                "environment": [{"name": "RUN_MIGRATIONS", "value": "false"}]}]}})
        if migration.get("failures") or len(migration.get("tasks", [])) != 1:
            raise RuntimeError("Migration task could not start.")
        task_arn = migration["tasks"][0]["taskArn"]
        result["migration_task"] = task_arn
        migration_pending = True
        call("wait", "tasks-stopped", "--cluster", cluster, "--tasks", task_arn)
        migration_pending = False
        stopped = call("describe-tasks", "--cluster", cluster, "--tasks", task_arn)
        tasks = stopped.get("tasks", [])
        completed = [container for task in tasks for container in task.get("containers", [])
                     if container.get("name") == "api"]
        if stopped.get("failures") or len(completed) != 1 or completed[0].get("exitCode") != 0:
            raise RuntimeError("Schema migration failed; service images were not changed.")

        for service in ["ai-service", "api", "web"]:
            print(f"Rolling out {service}.", flush=True)
            changed.append(service)  # Include ambiguous update responses in rollback.
            call("update-service", "--cluster", cluster, "--service", names[service],
                 "--task-definition", registered[service], "--deployment-configuration",
                 '{"deploymentCircuitBreaker":{"enable":true,"rollback":true}}')
            call("wait", "services-stable", "--cluster", cluster, "--services", names[service])
            state = call("describe-services", "--cluster", cluster, "--services", names[service])
            ensure_rollout(state["services"][0], registered[service])
        result["status"] = "success"
        return result
    except Exception:
        result["status"] = "failed"
        result["rollback_failures"] = []
        if migration_pending:
            try:
                call("stop-task", "--cluster", cluster, "--task", result["migration_task"],
                     "--reason", "Asteriq deployment halted")
            except Exception:
                result["migration_stop_failed"] = True
        for service in reversed(changed):
            try:
                call("update-service", "--cluster", cluster, "--service", names[service],
                     "--task-definition", previous[service])
                call("wait", "services-stable", "--cluster", cluster, "--services", names[service])
                state = call("describe-services", "--cluster", cluster, "--services", names[service])
                ensure_rollout(state["services"][0],previous[service])
            except Exception:
                result["rollback_failures"].append(service)
        raise
    finally:
        Path("deployment-result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        deploy(json.loads(Path(sys.argv[1]).read_text()))
    except Exception as error:
        print(f"Deployment failed: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
