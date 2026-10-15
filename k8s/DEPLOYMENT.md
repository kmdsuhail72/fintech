# Asteriq AI on KubernetesUse the [dual-domain HTTPS profiles](https/README.md) for `app.asteriq.ai` and`api.asteriq.ai`, ACM renewal, HTTPS redirects and the CloudFront/ALB choices.See the [account-free AWS EKS architecture demo](../infrastructure/eks/README.md)for CloudFront/WAF, infrastructure, managed services, IRSA and security controls.The [Kubernetes security review](security/README.md) includes Kyverno admissionpolicies, least-privilege RBAC, Trivy checks, resource budgets and remaining TLSand image-provenance findings.

This production runbook targets an IPv4 Amazon EKS cluster with EC2 worker nodes in at
least three availability zones. React/Nginx, Node.js and FastAPI run in private
subnets. Production PostgreSQL and Redis use RDS PostgreSQL with pgvector and
ElastiCache Redis. Optional local StatefulSets are provided for development.

These are configurable deployment artifacts. No EKS context, production images,
hostname, certificate or endpoint values have been supplied, so no application
has been deployed to a live cluster. Existing unrelated kind/minikube contexts
are not selected automatically.

## Architecture

```mermaid
flowchart TB
    users[Browser / mobile clients] -->|HTTPS / secure WebSocket| dns[Route 53]
    dns --> alb[Public AWS ALB<br/>ACM TLS certificate]
    controller[AWS Load Balancer Controller] -. reconciles Ingress .-> alb
    subgraph eks[Amazon EKS - private EC2 nodes across three AZs]
        ingress[Ingress - frontend target group]
        frontend[React + non-root Nginx<br/>3-12 pods]
        api[Node API + Socket.IO<br/>3-20 pods]
        ai[FastAPI research / RAG<br/>3-10 pods]
        migration[One-shot migration Job<br/>separate database identity]
        eso[External Secrets Operator]
        scaling[Metrics Server + HPA<br/>node autoscaler]
        policies[Default-deny NetworkPolicies<br/>restricted pod security]
        alb --> ingress --> frontend
        frontend -->|/api/v1 and /socket.io| api
        api -->|private Service :8000| ai
        ai -. authenticated evidence callback :3000 .-> api
        scaling -. scales .-> frontend
        scaling -. scales .-> api
        scaling -. scales .-> ai
    end
    api -->|PostgreSQL TLS| rds[(RDS PostgreSQL Multi-AZ<br/>pgvector)]
    ai -->|owner-scoped RAG data over TLS| rds
    ai -->|HTTPS research / embeddings| provider[OpenAI API]
    migration -->|DDL identity over TLS| rds
    api -->|rediss / TLS :6379| redis[(ElastiCache Redis<br/>replication group)]
    api -->|SMTP STARTTLS :587| ses[Amazon SES]
    eso -->|IRSA / temporary AWS credentials| secrets[AWS Secrets Manager]
    secrets -. synced Kubernetes Secrets .-> api
    secrets -. synced Kubernetes Secrets .-> ai
    secrets -. migration Secret .-> migration
    logs[CloudWatch Container Insights / Fluent Bit] -. collects stdout + EMF .-> eks
    s3[Amazon S3 - optional object integration]
    api -. requires application integration + scoped IAM role .-> s3
```

Only the frontend Service is exposed through ALB. Nginx proxies API and Socket.IO
traffic to the private API Service. API-to-AI and AI-to-API callbacks are both
allowed because authenticated AI research reads owner-scoped evidence from the
API. AI does not directly consume Redis in the current implementation.

Internet TLS terminates at ALB using ACM; this configuration uses private HTTP
inside the cluster. NetworkPolicy isolates traffic but does not encrypt it.
For an end-to-end encryption requirement, introduce a tested service mesh/mTLS
or TLS-capable internal listeners; changing an annotation alone is insufficient.
ALB certificate and listener behavior follows the
[AWS Load Balancer Controller annotations](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/ingress/annotations/).

## Repository structure

See [repository layout and configuration ownership](README.md).

## Every Kubernetes resource

| Resource                           | Purpose and behavior                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Namespace                          | `asteriq-production` separates application resources. Pod Security Admission enforces the restricted profile. Pin the policy version to your approved cluster release after testing upgrades. A namespace is not a complete tenant isolation boundary.                                                                                                                                    |
| Deployment                         | One per frontend/API/AI. Each starts with three replicas, keeps five revisions and uses `maxSurge: 1`, `maxUnavailable: 0`. `minReadySeconds: 10` avoids instantly promoting a transiently healthy pod. Kubernetes does not automatically roll back a stalled Deployment.                                                                                                                 |
| Service                            | Private ClusterIP and named HTTP ports: frontend 8080, API 3000, AI 8000. Selectors match pod labels. Service DNS provides discovery and ready-endpoint routing; no public NodePort or database LoadBalancer is created.                                                                                                                                                                  |
| ConfigMap                          | Non-secret runtime URLs, mail sender, proxy trust and observability settings. A separate map contains the non-root Nginx configuration. The RDS map contains only public CA certificates. Env-based changes require a controlled pod restart.                                                                                                                                             |
| Secret                             | API requires `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `SMTP_URL`; AI requires `RAG_DATABASE_URL`, `OPENAI_API_KEY`; migration uses a distinct `DATABASE_URL`. Examples contain placeholders only. Production ExternalSecrets create actual Opaque Secrets; enable cluster encryption and restrict read/write/mount privileges.                                                   |
| Ingress                            | AWS controller provisions an internet-facing ALB, routes `/` to frontend, redirects port 80 to 443, attaches ACM, uses IP targets and `/health` target checks. Existing tagged public subnets and an `alb` IngressClass/controller are prerequisites.                                                                                                                                     |
| ServiceAccount                     | Separate runtime identities for frontend, API, AI and migration, with Kubernetes token automount disabled and no application RBAC grants. `secrets-reader` is used by ESO through IRSA, not by application pods.                                                                                                                                                                          |
| HorizontalPodAutoscaler            | `autoscaling/v2`, CPU target 65% and memory target 80%; production frontend 2–10, API 3–20, AI 2–15. Utilization uses resource requests as its denominator. See [autoscaling](autoscaling/README.md) for custom metrics and node scaling. Requires Metrics Server; it does not create nodes or guarantee throughput. Scale-down waits five minutes and removes at most one pod per minute. See [Kubernetes HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/). |
| PodDisruptionBudget                | Allows one unavailable pod per workload during voluntary evictions. Unhealthy pods can be evicted to unblock maintenance. It does not protect against AZ failures and does not control Deployment rolling updates. See [Kubernetes PDB behavior](https://kubernetes.io/docs/tasks/run-application/configure-pdb).                                                                         |
| NetworkPolicy                      | Default-deny ingress/egress; allow DNS, ALB-to-frontend, frontend-to-API, API-to-AI, AI callback-to-API, and explicit data/provider egress. Policy selectors stay within the application namespace. Enforcement needs a supporting CNI.                                                                                                                                                   |
| SecretStore / ExternalSecret       | ESO custom resources authenticate to AWS Secrets Manager using an IRSA role scoped to application secret ARNs. No AWS access keys are stored. ESO installation/RBAC and its own AWS/DNS network access are platform responsibilities. See [ESO AWS provider](https://external-secrets.io/latest/provider/aws-secrets-manager/).                                                           |
| Job                                | Runs the scanned API image's existing migration script before rollout, with a separate Secret and ServiceAccount. No automatic retry; execution expires after ten minutes. SQL advisory locking/checksums remain in the existing migration runner.                                                                                                                                        |
| StatefulSet / volumeClaimTemplates | Optional single-instance local PostgreSQL/Redis retain data through PVCs. They are not a production HA alternative to managed services or a database operator.                                                                                                                                                                                                                            |

## Runtime, availability and scaling

All application pods run as non-root with no added capabilities, no privilege
escalation, RuntimeDefault seccomp, and read-only root filesystems. Only bounded
`emptyDir` volumes are writable. Frontend uses UID 101, API 1000, AI 10001.
The frontend command generates `/tmp/nginx.conf`, places PID/temp paths in `/tmp`,
and bypasses the existing image's root entrypoint. AI artifacts are ephemeral;
news-model downloads are disabled by default. Images must be scanned linux/amd64
digests; the pods select amd64 Linux nodes.

Preferred node anti-affinity spreads replicas across machines. Required zone
spread with maximum skew one spreads ready capacity across available AZ domains;
it does not by itself create three zones. Provision a three-AZ node pool and a
node autoscaler such as Karpenter/Cluster Autoscaler with enough surge/IP capacity.
Initial requests total approximately 4.8 CPU and 7.9 GiB, excluding system pods
and rollout surge. Size nodes from measured load, not only these initial values.

| Workload | CPU request / limit | Memory request / limit | Liveness / readiness               |
| -------- | ------------------- | ---------------------- | ---------------------------------- |
| Frontend | 100m / 500m         | 128Mi / 256Mi          | `/health` / `/health`              |
| API      | 500m / 2            | 512Mi / 1Gi            | `/api/v1/health` / `/api/v1/ready` |
| AI       | 1 / 2               | 2Gi / 4Gi              | `/health/live` / `/health/ready`   |

Startup probes allow up to five minutes and suppress other probes until success.
API readiness checks PostgreSQL/Redis/schema; API liveness is independent of
those dependencies to avoid restart storms. The current AI health aliases check
process availability only, not provider reachability, database connectivity or
model readiness. Do not interpret them as proof that all research operations work.
Probe behavior follows [Kubernetes probe semantics](https://kubernetes.io/docs/concepts/workloads/pods/probes/).

Pods wait 35 seconds in preStop for endpoint/ALB draining, then receive their
normal termination signal. The grace period is 180 seconds; Uvicorn permits 100
seconds for in-flight requests. ALB deregistration delay is 30 seconds and idle
timeout 180 seconds. Node already handles SIGTERM/SIGINT and closes workers,
sockets and database/cache clients. Nginx uses its image's graceful stop signal.
Rollouts disconnect long-lived WebSockets; clients must reconnect and resubscribe.
Existing clients use WebSocket-only transport and the server's Redis adapter
shares broadcasts between API replicas. Enabling Engine.IO polling later requires
affinity at the API tier; ALB frontend affinity alone is insufficient.

CPU HPA is a starting policy. AI vendor waits may require concurrency/queue metrics
through a metrics adapter/KEDA; API scaling should also consider request latency
and WebSocket counts. Budget RDS connections for all replicas and migration/admin
headroom: the default Node pool can consume up to 10 connections per API pod.
Run the existing k6 suite before asserting any 10,000-user capacity.

## AWS and security prerequisites

1. An explicitly selected EKS context, private EC2 nodes across three AZs,
   private RDS/ElastiCache endpoints, NAT or suitable VPC endpoints, and ECR pull
   permissions on the node role. Install AWS Load Balancer Controller, Metrics
   Server, and External Secrets Operator with their CRDs and platform IAM/RBAC.
2. Enable actual network-policy enforcement. For VPC CNI, configure network
   policy support and evaluate strict startup enforcement. See
   [AWS VPC CNI policy setup](https://docs.aws.amazon.com/eks/latest/userguide/cni-network-policy-configure.html).
   These policies assume CoreDNS pods labeled `k8s-app: kube-dns`; NodeLocal DNS
   or another DNS topology requires explicit rule changes.
3. Create ACM and Route 53 records. The ALB security group accepts public 443/80
   and reaches only frontend pod port 8080. Data security groups allow private
   PostgreSQL 5432 and Redis 6379 only from approved workload/node/pod identities.
   Kubernetes NetworkPolicy complements AWS security groups; it does not replace them.
4. Replace ALB-subnet and private-data-subnet CIDRs in production policies.
   Standard NetworkPolicy cannot match managed-service DNS names; subnet ranges
   accommodate failover IPs, while security groups restrict actual endpoints.
   Public HTTPS/SMTP egress excludes RFC1918, loopback and link-local ranges.
   Add narrowly scoped rules for private AWS endpoints if used. For SaaS hostname
   restrictions, introduce an egress gateway/FQDN-aware CNI rather than assuming
   a TCP 443 rule validates destinations.
5. Populate AWS Secrets Manager names referenced by `external-secrets.yaml`.
   The IRSA trust must match the cluster OIDC issuer, audience `sts.amazonaws.com`
   and subject `system:serviceaccount:asteriq-production:secrets-reader`.
   Apply the scoped policy example; add key-specific `kms:Decrypt` if secrets use
   a customer-managed key. Do not attach this reader role to runtime pods.
6. Use different SQL identities for API, owner-scoped AI reads/RAG writes and
   migrations. Runtime identities must not own the schema or have DDL grants.
   Populate RDS CA ConfigMap with the current public bundle from
   [AWS RDS certificate guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).
   Database URLs must use `sslmode=verify-full` and
   `sslrootcert=/etc/rds-ca/global-bundle.pem`. Redis URLs use `rediss://` and
   validated TLS certificates. Never disable certificate verification.
7. Configure verified SES sender/production access and SMTP STARTTLS submission
   on 587. Existing Node email code uses SMTP; IAM SES SendEmail permissions alone
   do not replace SMTP credentials. Optional S3 integrations need scoped workload
   IAM and application implementation; these manifests do not invent a bucket uploader.
8. Collect JSON stdout/EMF with CloudWatch/Fluent Bit and enable Container Insights.
   Existing trace IDs provide correlation. Configure alert subscriptions and
   backup/restore drills; installing Kubernetes does not complete those operations.

Secrets synchronized into Kubernetes are not encrypted merely because they are
base64-encoded. Enable control-plane encryption, restrict RBAC and audit secret
access. ESO refresh updates Secret data, but environment variables in running pods
do not rotate; deliberately roll out affected workloads after rotation. Coordinate
JWT changes across replicas so token validation stays consistent.

## Configure, validate and deploy

Replace every `REPLACE_*`, example hostname/sender, zero image digest, region and
secret prefix. Keep actual Secret values out of Git. The `.example.yaml` Secret
files document keys and are not included in Kustomize resources. With ESO,
production Kubernetes Secrets are created by the controller.

Build the frontend with `VITE_API_URL=/api/v1`; point the existing API and AI
Dockerfiles at their runtime stages. Promote the same scanned digest for API
runtime and migrations. Do not use mutable `latest` tags for promotion.

```powershell
python -m pip install -r scripts/kubernetes/requirements.txt -r apps/ai-service/requirements-dev.txt
kubectl kustomize k8s/environments/production
python -m pytest scripts/kubernetes/tests -q -p no:cacheprovider

# After supplying actual production settings:
python scripts/kubernetes/deploy.py --context YOUR_EKS_CONTEXT --release abc123 --render-only
python scripts/kubernetes/deploy.py --context YOUR_EKS_CONTEXT --release abc123
```

The script rejects unresolved placeholders and mutable images before contacting
the cluster. It explicitly selects context, creates the namespace, runs server
admission dry-run, applies supporting resources, waits for ExternalSecrets,
runs the migration Job, rolls out AI, API and frontend sequentially with readiness gates,
and only then applies Ingress. First deployment does not expose an uninitialized
application. A failed migration prevents application image changes. Server dry-run
requires installed CRDs/controllers and a reachable authorized target.

The script omits `spec.replicas` during promotion so an existing HPA-scaled
Deployment is not reset to its initial replica count on each release. A newly
created Deployment bootstraps to the selected environment's count (dev 1,
staging 2, production 3), then HPA owns scaling. Repeatedly applying raw replica
counts can reset HPA capacity.
The existing GitHub production workflow still targets ECS; this Kubernetes
deployment path does not silently switch that workflow to a different platform.

For subsequent releases use a unique lowercase release ID. Configuration-only
changes require a controlled rollout restart after successful migrations, because
static ConfigMaps/env references do not change the pod template automatically.
Inspect rollouts and logs with explicit context:

```powershell
kubectl --context YOUR_EKS_CONTEXT -n asteriq-production get deploy,pods,svc,hpa,pdb,ingress
kubectl --context YOUR_EKS_CONTEXT -n asteriq-production describe deployment/api
kubectl --context YOUR_EKS_CONTEXT -n asteriq-production logs deployment/api --tail=100
kubectl --context YOUR_EKS_CONTEXT -n asteriq-production rollout undo deployment/api
```

The script halts on failure; it does not automatically undo database changes or
claim that Kubernetes performs rollback for it. Keep expand/contract migrations
backward-compatible and promote a coherent frontend/API/AI release. For a failed
application release, review and restore each affected Deployment's previous
revision or apply the prior immutable overlay. Preserve backups before DDL.

## Optional local PostgreSQL and Redis

`optional/local-data/resources.yaml` supplies private headless Services,
single-replica StatefulSets, PVC templates and matching ingress/egress policies.
Apply in a dedicated development namespace that also contains the application's
base resources. Provide a `local-data-secrets` Secret with `POSTGRES_PASSWORD`
and `REDIS_PASSWORD`, an available default StorageClass, and separate API/AI
connection Secrets pointing at `postgres:5432` and `redis:6379`.

Local PostgreSQL uses pgvector; migrations create schema/extensions. Configure
local development's API mode/email and ingress separately; production ALB/managed
egress/RDS certificate patches are not a local deployment overlay. Do not apply
these StatefulSets in production, use their owner account as a production runtime
identity, or increase replicas expecting automatic database replication. Production
HA/backup/failover remain responsibilities of RDS/ElastiCache or a reviewed operator.

## Validation status

The reorganized repository passes fourteen rendering, environment isolation,
compatibility, deployment-order, duplicate-YAML and HPA/initial-scaling tests.
In the preceding runtime validation, forty-six synthetic
native-resource copies passed strict server dry-run against the existing local
Kubernetes v1.36 API; no resources were persisted. That check excludes ESO CRDs
and replaces placeholder CIDRs with synthetic valid ranges. The Nginx configuration
also passed syntax and health smoke testing as UID 101 with a read-only root
filesystem, dropped capabilities and no published ports.

Target-cluster admission, EKS ALB provisioning, full application image startup,
CNI enforcement, AWS secret synchronization and application smoke/load tests
require the supplied deployment target and values. This validation does not
claim that production is deployed or that AWS integration is proven.
