# Asteriq AI Helm charts

[The `asteriq-platform` umbrella chart](asteriq-platform/README.md) installs all
three application dependencies with one release and environment values files.

Three independent `apiVersion: v2` application charts for Helm 3/4 package React/Nginx,
Node API and Python FastAPI workloads. They do not install databases, controllers,
Namespaces or secret-management operators as hidden dependencies.

```text
helm/
├── asteriq-web/
├── asteriq-api/
└── asteriq-ai-service/
    ├── Chart.yaml
    ├── values.yaml
    ├── values-dev.yaml
    ├── values-staging.yaml
    ├── values-production.yaml
    ├── values.schema.json
    └── templates/
        ├── _helpers.tpl
        ├── deployment.yaml
        ├── service.yaml
        ├── ingress.yaml
        ├── configmap.yaml
        ├── serviceaccount.yaml
        ├── hpa.yaml
        ├── pdb.yaml
        └── NOTES.txt
```

Each chart contains every file shown. The web chart also packages its non-root
Nginx configuration under `files/`. Charts use SemVer versions, scoped helper
names, standard Helm labels, release-specific immutable selectors, named ports,
and a JSON schema. A ConfigMap checksum triggers rollouts when configuration
changes. These conventions follow [Helm best practices](https://helm.sh/docs/chart_best_practices/).

## Configuration

| Value                                                   | Behavior                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `image.repository`, `image.tag`, `image.digest`         | Registry/image and release version. A nonempty SHA-256 digest takes precedence over tag; prefer scanned immutable digests in production.                           |
| `replicaCount`                                          | Deployment count when autoscaling is disabled.                                                                                                                     |
| `resources.requests`, `resources.limits`                | CPU and memory quantities, quoted strings.                                                                                                                         |
| `env`                                                   | Non-secret string-valued ConfigMap variables. Never put passwords, tokens or private keys here.                                                                    |
| `existingSecrets`                                       | Names of pre-provisioned Secrets loaded through envFrom. API defaults to `api-secrets`; AI defaults to `ai-service-secrets`.                                       |
| `extraEnv`                                              | Additional Kubernetes env entries, including `valueFrom.secretKeyRef` for individual keys.                                                                         |
| `service.port`, `service.containerPort`, `service.type` | Service and container HTTP port/type. The API listener and AI Uvicorn/Nginx listeners follow containerPort; probes/Service route to named `http`.                  |
| `ingress`                                               | Optional ingress class, annotations, hosts/paths and TLS. API/AI ingress is disabled in every supplied profile.                                                    |
| `serviceAccount`                                        | Create/reuse an account, annotations and token automount. Runtime token mounting defaults off.                                                                     |
| `autoscaling`                                           | CPU/memory targets, optional additionalMetrics, replica limits, and scale-up/down behavior. Requires Metrics Server and sufficient node capacity.                                                      |
| `probes.startup/readiness/liveness`                     | Individually enable/disable and configure Kubernetes probe fields. Default paths match existing applications.                                                      |
| `pdb`                                                   | Enable disruption budget and configure maxUnavailable/eviction policy.                                                                                             |
| `scheduling`                                            | Preferred node anti-affinity and optional required zone spreading.                                                                                                 |
| `rdsCa`                                                 | Optional existing public CA ConfigMap mounted into API/AI; API sets NODE_EXTRA_CA_CERTS. Database URLs must still select verified TLS and the mounted root bundle. |
| `extraVolumes`, `extraVolumeMounts`                     | Additional operator-managed mounts.                                                                                                                                |

The API's `API_PORT` is derived from `service.containerPort`. Its RDS trust setting
is derived from `rdsCa`; use those fields rather than contradictory env entries.
For other environment variables use quoted strings, including booleans/numbers.
Use `--set-string env.FLAG=false` for CLI environment overrides; `--set` would
parse that value as a boolean and fail the string-valued environment schema.
Secret values are never rendered into chart templates. Helm stores supplied values
in release metadata, so supplying credentials with `--set` is not a secret-management
strategy. Rotation of existing Secrets requires a deliberate workload restart.
The schema rejects common credential keys in `env`; use existing Secrets or
`extraEnv.valueFrom.secretKeyRef` for those fields.

## Environment profiles

| Profile    | Replicas / HPA minimum | Autoscaling | Required AZ spread |
| ---------- | ---------------------- | ----------- | ------------------ |
| dev        | 1                      | disabled    | no                 |
| staging    | 2                      | enabled     | yes                |
| production | 3                      | enabled     | yes                |

Profiles preserve `frontend`, `api` and `ai-service` Service names for the current
Nginx proxy, private AI callback and platform NetworkPolicies. Public hostname,
mail sender, registry/account, release tag/digest and ACM ARN values are examples
or placeholders; configure them before installation. Node runs in production
mode even in hosted dev; debug authentication tokens remain disabled.

Without a profile, names are release-scoped. Recommended release names `api`,
`ai`, and `web` match default service discovery. Custom release names or fullname
overrides require matching `env.API_UPSTREAM`, `env.AI_SERVICE_URL`, and
`env.RESEARCH_BACKEND_URL`. If you change a Service's port, update its callers'
URLs as well. Build frontend images with `VITE_API_URL=/api/v1`.
Update platform NetworkPolicy port rules if container ports change. If exposing
API directly through ingress, adjust proxy trust to the actual hop count;
`TRUST_PROXY_HOPS=2` assumes ALB then frontend Nginx before the API.

Autoscaled Deployment templates omit replicas so Helm upgrades do not reset an
HPA-owned count. On a fresh installation, Kubernetes initially defaults to one
pod and HPA converges to its configured minimum. Check actual ready capacity
before admitting production traffic; `helm --wait` alone is not a load/capacity
test. Maintain the existing 35-second drain and 180-second termination budget
unless tested alternatives cover the application's in-flight requests.

## Lint, render and package

```powershell
helm lint helm/asteriq-web --strict -f helm/asteriq-web/values-production.yaml
helm lint helm/asteriq-api --strict -f helm/asteriq-api/values-production.yaml
helm lint helm/asteriq-ai-service --strict -f helm/asteriq-ai-service/values-production.yaml
helm template api helm/asteriq-api --namespace asteriq-staging -f helm/asteriq-api/values-staging.yaml
helm package helm/asteriq-api --destination .runtime/helm-packages
python -m pytest scripts/helm/tests -q -p no:cacheprovider
```

Helm templates are excluded from Prettier's YAML parser; Helm lint/template and
rendered-output regression tests validate them. Values, schemas and docs remain
formatted. Packaging needs no chart dependencies or remote repository download.

## Installation and ownership

Provision the environment Namespace, enforcing NetworkPolicies, External Secrets
integration and the `rds-ca` ConfigMap through platform management first. Supply
the API/AI Secret contracts described in [the Kubernetes runbook](../k8s/DEPLOYMENT.md).
Use private RDS/ElastiCache endpoints and dedicated runtime/AI/migration identities.

Run the existing one-shot migration Job using the scanned API digest and the
separate `migration-secrets` Secret **before** API promotion. Do not migrate in
each application replica or use runtime DDL credentials. Then install/upgrade AI,
API, and frontend in that order with explicit context and actual configured values:

```powershell
helm upgrade --install ai helm/asteriq-ai-service --kube-context YOUR_EKS_CONTEXT --namespace asteriq-production -f helm/asteriq-ai-service/values-production.yaml --wait --timeout 10m
helm upgrade --install api helm/asteriq-api --kube-context YOUR_EKS_CONTEXT --namespace asteriq-production -f helm/asteriq-api/values-production.yaml --wait --timeout 10m
helm upgrade --install web helm/asteriq-web --kube-context YOUR_EKS_CONTEXT --namespace asteriq-production -f helm/asteriq-web/values-production.yaml --wait --timeout 10m
```

ALB/ACM requires AWS Load Balancer Controller and valid public-subnet discovery.
Only frontend Ingress is enabled in staging/production. TLS terminates at ALB;
internal Services remain HTTP. Current AI readiness is process-level rather than
a provider/database readiness guarantee. Sockets reconnect during rolling updates.

These charts do not automatically adopt resources owned by Kustomize or another
Helm release. Plan the ownership handoff; do not simultaneously apply the full
`k8s/environments` application bundle and these charts against the same names.
Keep platform security/secret resources under their existing management boundary.
Selectors remain stable across chart version/image upgrades.

Review failed releases and use `helm rollback` for the affected application after
checking compatibility. It does not undo database migrations. Use expand/contract
DDL and a coherent three-image release. Charts/templates do not prove deployed
image availability, AWS integration or production throughput.

## Validation

All three charts pass strict Helm lint. Thirty-eight rendered-output regressions
cover default and environment profiles, selectors, security settings, HPA ownership,
ports/listeners, probe toggles, ingress/TLS, immutable digests, config checksums,
CA mounts, credential/schema rejection, and independent chart packaging. Values,
schemas and documentation pass formatting checks. No chart was installed into a
cluster during this conversion.
