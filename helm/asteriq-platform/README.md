# Asteriq platform umbrella chart

[Argo CD deployment](../../gitops/README.md) enables an optional PreSync migration
hook. It defaults off for imperative Helm installs. The hook normally uses the
API digest; reviewed rollbacks can retain a newer migration catalog through
`migration.image.repository/digest`.

Installs the three application charts as one Helm release:

- `asteriq-web` — React/non-root Nginx frontend
- `asteriq-api` — Node API and Socket.IO
- `asteriq-ai-service` — FastAPI research and document service

All dependencies use local `file://../...` repositories pinned to the exact
versions in `Chart.yaml` and `Chart.lock`.
`Chart.lock` records dependency resolution; `charts/` contains bundled dependencies
so the requested command works without fetching charts from a remote repository:

```powershell
helm upgrade --install asteriq ./helm/asteriq-platform
```

That command installs into the selected context's default namespace. For an
environment, prepare its namespace/security/Secrets and select it explicitly:

```powershell
helm upgrade --install asteriq ./helm/asteriq-platform --namespace asteriq-dev -f ./helm/asteriq-platform/values-dev.yaml --wait --timeout 10m
helm upgrade --install asteriq ./helm/asteriq-platform --namespace asteriq-staging -f ./helm/asteriq-platform/values-staging.yaml --wait --timeout 10m
helm upgrade --install asteriq ./helm/asteriq-platform --namespace asteriq-production -f ./helm/asteriq-platform/values-production.yaml --wait --timeout 10m
```

Use `--kube-context YOUR_CONTEXT` when deploying to a specific target. Replace
example domains, ECR account/repositories, image tags/digests, sender and ACM ARN
before deployment. Supplying `environment=production` alone does not load the
production values file: choose the profile using `-f`.

## Values and routing

Child values are nested under their dependency names. For example:

```yaml
asteriq-api:
  image:
    repository: YOUR_ECR_REGISTRY/asteriq-production/api
    tag: YOUR_RELEASE_TAG
    digest: '' # A configured SHA-256 digest takes precedence over tag.
  resources:
    requests:
      cpu: '500m'
      memory: '512Mi'
  existingSecrets:
    - api-secrets
```

The umbrella selects fixed Service names `frontend`, `api`, and `ai-service` and
sets the peer URLs consistently. Release names can vary without breaking those
URLs. One platform release owns those names per namespace; for multiple instances
in one namespace, change all child fullname overrides and matching caller URLs.
Platform NetworkPolicies continue to match each component's existing pod labels.

| Profile     | Initial/minimum replicas | HPA      | Frontend ingress |
| ----------- | ------------------------ | -------- | ---------------- |
| default/dev | 1                        | disabled | disabled         |
| staging     | 2                        | enabled  | ALB              |
| production  | 3                        | enabled  | ALB              |

Dev/default use production API security settings and do not enable debug auth
tokens. Staging/production retain AZ spread. API and AI ingress stay private.
Each child supports `enabled: false` if an explicitly partial release is needed;
disabling a required dependency does not automatically reconfigure its callers.

Secrets remain externally provisioned; credentials are not values. For API supply
`api-secrets`; for AI supply `ai-service-secrets`; supply `rds-ca` where enabled.
See [child chart configuration and security](../README.md) for all supported knobs.

## Platform prerequisites and release behavior

This chart installs the application tier, not RDS, Redis, EKS, an ingress
controller, Metrics Server or External Secrets Operator. Prepare the platform
resources described in [the Kubernetes runbook](../../k8s/DEPLOYMENT.md).
Run the existing isolated migration Job with the promoted API digest and
`migration-secrets` before upgrading the release.

Helm applies subcharts within the same release; dependency order is not a
sequential readiness gate. Unlike the separate Kubernetes promotion script,
the umbrella does not guarantee AI completes rollout before API/frontend.
Use backward-compatible API/AI contracts and expand/contract migrations. Check
actual healthy capacity; HPA minima converge after creation. Helm rollback
restores application release resources, not database changes.

Do not simultaneously manage these resources with standalone application releases
or full Kustomize application overlays. Existing standalone releases require an
explicit ownership migration; this chart does not silently adopt them.

## Rebuild, validate and package

After modifying a child chart, update its version and the matching dependency
version, then regenerate the lock and bundled artifacts. Use a controlled empty
repository configuration for offline local resolution:

```powershell
# repositories.local.yaml contains: repositories: []
helm dependency update ./helm/asteriq-platform --skip-refresh --repository-config repositories.local.yaml
# Reproduce the checked-in lock:
helm dependency build ./helm/asteriq-platform --skip-refresh --repository-config repositories.local.yaml
helm lint ./helm/asteriq-platform --strict -f ./helm/asteriq-platform/values-production.yaml
helm template asteriq ./helm/asteriq-platform --namespace asteriq-production -f ./helm/asteriq-platform/values-production.yaml
helm package ./helm/asteriq-platform --destination .runtime/helm-packages
python -m pytest scripts/helm/tests -q -p no:cacheprovider
```

Keep `Chart.yaml`, `Chart.lock` and bundled dependencies consistent. No dependency
refresh is required for installation when the bundled archives are present.

Validation: all four default/environment configurations pass strict lint and
rendering. The combined Helm suite passes 48 tests, covering one-release routing,
profile settings, dependency conditions, offline rebuild and complete packaging,
alongside the application-chart regressions. No cluster installation was performed.
