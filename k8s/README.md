# Asteriq AI Kubernetes repository

`k8s/` is the canonical Kubernetes source tree. Application modules define
reusable workload behavior; environment overlays own deployment-specific values.
Monitoring is installed separately from application promotion.

```text
k8s/
├── base/
│   ├── frontend/           deployment, service, account, config, HPA, PDB, Nginx
│   ├── api/                deployment, service, account, config, HPA, PDB
│   ├── ai-service/         deployment, service, account, config, HPA, PDB
│   └── kustomization.yaml
├── environments/
│   ├── dev/
│   ├── staging/
│   └── production/
│       ├── application-config.yaml
│       ├── scaling.yaml
│       ├── resources.yaml
│       ├── aws-settings.yaml
│       ├── managed-networkpolicies.yaml
│       ├── rds-ca.yaml
│       ├── rds-mounts.yaml
│       └── kustomization.yaml
├── monitoring/
│   ├── namespace.yaml
│   ├── prometheus/         chart values + workload alert rules
│   ├── grafana/            chart values + provisioned datasources/dashboard
│   ├── loki/               distributed chart values + Alloy collection example
│   └── elk/                ECK Elasticsearch/Kibana + Logstash pipeline example
├── ingress/                reusable ALB Ingress
├── security/
│   ├── network-policies/   default-deny, DNS and application traffic
│   ├── external-secrets/   shared SecretStore and secret-key mappings
│   ├── migration/          isolated migration ServiceAccount
│   ├── iam/                AWS policy template
│   └── examples/           Secret shapes without credentials
├── namespaces/
│   ├── dev/
│   ├── staging/
│   └── production/
├── jobs/                   migration Job template
├── optional/local-data/    development-only PostgreSQL/Redis
└── DEPLOYMENT.md            architecture and deployment operations
```

## Configuration ownership

| Location                     | Owns                                                                                                                                                                 | Must not contain                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `base/<application>`         | Internal ports/URLs, labels, probes, shutdown, container security, default resource shape, Service and scaling definitions                                           | Public environment domains, AWS account/region, certificate ARNs, real secrets |
| `environments/<environment>` | Runtime mode, hostname/sender, replica/HPA bounds, resource overrides, approved image digests, IAM role/region, secret prefix, subnet CIDRs, RDS public trust bundle | Inline database passwords, JWT signing keys, SMTP/OpenAI credentials           |
| `namespaces/<environment>`   | Namespace identity and restricted Pod Security labels                                                                                                                | Shared namespace across environments                                           |
| `ingress`                    | ALB routing and listener/proxy behavior                                                                                                                              | Actual environment certificate/domain                                          |
| `security`                   | Application traffic graph, secret key contracts, isolated migration identity                                                                                         | Hardcoded AWS access keys or shared runtime/migration database identity        |
| `monitoring`                 | Operator/chart profiles, cluster metrics rules, dashboard provisioning, logging examples                                                                             | Application rollout dependencies or automatically installed operators          |

Environment ConfigMap patches merge into the application ConfigMaps. Secrets
remain separate and are populated by External Secrets Operator from AWS Secrets
Manager. Namespace transformation scopes every application resource. Environment
patches override shared Ingress/SecretStore templates without copying Deployments.
Public CA certificates are configuration, not credentials.

| Environment | Namespace            | Initial/HPA minimum replicas | Maximum frontend / API / AI |
| ----------- | -------------------- | ---------------------------- | --------------------------- |
| dev         | `asteriq-dev`        | 1                            | 3 / 4 / 2                   |
| staging     | `asteriq-staging`    | 2                            | 6 / 8 / 4                   |
| production  | `asteriq-production` | 3                            | 12 / 20 / 10                |

All profiles run release images with production API security settings; development
does not enable debug authentication tokens. Dev removes the required AZ spread
constraint to permit a single-node test environment. Staging/production retain AZ
spread. A one-replica development PDB permits downtime during maintenance; it is
not a high-availability profile.

These overlays target managed AWS data services and ALB. Local PostgreSQL/Redis
resources are optional and require an explicitly adapted local ingress, connection
Secrets and network policy. Do not mix production data destinations into dev.
Use separate clusters/accounts for stronger production isolation: namespaces
alone do not isolate cluster administrators, CRDs or node compromise.

## Render and promote

```powershell
kubectl kustomize k8s/base
kubectl kustomize k8s/environments/dev
kubectl kustomize k8s/environments/staging
kubectl kustomize k8s/environments/production

python -m pip install -r scripts/kubernetes/requirements.txt -r apps/ai-service/requirements-dev.txt
python -m pytest scripts/kubernetes/tests -q -p no:cacheprovider

# After configuring actual environment values:
python scripts/kubernetes/deploy.py --context YOUR_EKS_CONTEXT --overlay k8s/environments/staging --release abc123
```

Replace every `REPLACE_*` and zero image digest before promotion. Never commit
Secret values. The deployment script renders the selected overlay, validates
admission, synchronizes Secrets, migrates with the selected API digest, and rolls
out AI, API, then frontend. New workloads bootstrap to the chosen environment's
replica count; existing HPA-owned counts are preserved. ConfigMap-only changes
require a controlled restart.

See [deployment architecture and runbook](DEPLOYMENT.md) for AWS prerequisites,
TLS, migration grants, rollback, rotation, and runtime caveats. The existing
GitHub production deployment workflow continues to target ECS.

## Monitoring profiles

Install a selected, version-pinned monitoring stack into the separate `monitoring`
namespace. Chart `values.example.yaml` files are Helm inputs, not Kubernetes
resources; each Kustomization includes only actual objects. No monitoring stack
is automatically applied by an application environment overlay.

- [Prometheus](monitoring/prometheus/README.md): cluster/workload metrics and alert rules.
- [Grafana](monitoring/grafana/README.md): private dashboard UI and provisioned configuration.
- [Loki](monitoring/loki/README.md): object-storage logging with a scoped AWS workload identity.
- [ELK](monitoring/elk/README.md): an alternative ECK-managed search/logging profile.

Choose Loki or ELK according to retention/search needs; running both is not
required. CloudWatch remains available through the existing EMF/stdout setup.
API and AI expose private Prometheus `/metrics` endpoints. The Prometheus
runbook includes ServiceMonitors, scrape network policies, alert rules and
queries for Kubernetes, application and business signals.

The former `infrastructure/kubernetes/base` and production-overlay paths contain
compatibility Kustomizations that delegate here. They contain no duplicate
application manifests. New configuration changes belong under `k8s/`.

## Verification

Fourteen regressions pass, covering all three environment namespaces/configuration,
secret-prefix isolation, base neutrality, legacy production equivalence, migration
and rollout order, HPA-safe bootstrap counts, and all four monitoring renderers.
Formatting and Python syntax checks pass. Monitoring chart/operator installation
and target-cluster AWS integration are not performed by these repository checks.
