# Asteriq Kubernetes security review

This review covers repository configuration and an account-free EKS demo, not a
live cluster audit. No policies have been installed on a cluster. Admission
examples use Kyverno **1.19.1 CEL ValidatingPolicy** APIs; match the controller,
CRDs and CLI when activating them. Legacy ClusterPolicy APIs are deprecated in
Kyverno 1.19, so these examples use the current API.

## Review findings

| Severity | Finding | Result |
| --- | --- | --- |
| High | EKS application deployment role had cluster-admin | Fixed: namespace-scoped EKS Edit; separate administrator retains platform access |
| High | Helm security defaults could be overridden without admission enforcement | Added fail-closed, Deny admission policies; activation still requires Kyverno |
| High | Host networking, root/privileged init and ephemeral containers could bypass a regular-container-only check | Policy covers regular/init/ephemeral containers and controller templates |
| High | Root filesystem/resource bounds depended on chart defaults | Added admission checks, production quota and container LimitRange |
| Medium | No dedicated support RBAC profile | Added read-only namespace Role; no Secret, exec, attach, TokenRequest or write access |
| Medium | Image digests and public service exposure lacked admission checks | Added production ECR/digest, ClusterIP-only and TLS Ingress policies |
| Medium | Restricted namespace labels could be removed by administrators | Added namespace-label admission guard scoped by fixed namespace names |
| Medium | Trivy CI lacked a rendered Kubernetes misconfiguration gate | Added pinned security workflow alongside existing image/dependency/secret scans |
| High, open | Application service-to-service traffic and Collector-to-Tempo are private plaintext | External/data TLS exists; internal TLS certificate examples require real listeners/proxies/mesh |
| High, open | Digest pinning does not prove an image was scanned or signed | Existing CI scans before publication/promotion; restrict registry publishers and add trusted signature/scan attestations for admission provenance |
| Medium, open | Logging agents require root/hostPath and a privileged PSA namespace | Deliberate platform exception, outside application namespaces; restrict namespace administration and audit agents |
| Medium, open | Public HTTPS egress is broad | Existing port/CIDR policies are not hostname enforcement; use an egress proxy/firewall for approved LLM domains |

Trivy initially reported `KSV-0109` on the **non-secret** boolean
`DEV_AUTH_TOKEN_OUTPUT=false` in the API ConfigMap. The switch now lives in
explicit container environment entries, preserving its value without suppressing
the ConfigMap credential check. Secrets continue to come from Secret references.
Local scans of rendered Helm and production Kustomize application resources use
Trivy 0.75.0 embedded checks, with HIGH/CRITICAL configured to fail. They are not
image CVE scans or a guarantee that arbitrary third-party controllers are secure.

Validation completed: 45 security-policy tests passed, Helm chart regression
checks passed, the EKS namespace-access mock plan passed, and both rendered
deployment paths passed the Trivy HIGH/CRITICAL configuration gate. Kyverno also
evaluated all three actual production Kustomize Deployments successfully.

## Admission controls

| File | Control |
| --- | --- |
| `kyverno/pod-hardening.yaml` | Non-root UID, read-only root, no privilege escalation, no added capabilities, RuntimeDefault seccomp, resource requests/limits and dedicated service accounts |
| `kyverno/images.yaml` | Production ECR registry/repository allowlist and nonzero immutable digests |
| `kyverno/ingress-and-services.yaml` | ALB HTTPS/certificate enforcement and private ClusterIP Services |
| `kyverno/namespaces.yaml` | Preserve Restricted PSA enforce/audit/warn labels |
| `rbac/` | Production support read-only Role/Binding and disabled default-SA token automount |
| `limits/` | Production namespace ResourceQuota and per-container LimitRange |
| `examples/image-rollout-rbac.example.yaml` | Narrow optional existing-Deployment patch permission for trusted releases |
| `examples/internal-tls.example.yaml` | Private PKI certificate-provisioning example, not application TLS listeners |

Pod policy matches Pods (including ephemeral-container updates), Deployments,
StatefulSets, DaemonSets, ReplicaSets, Jobs and CronJobs. It checks controller
templates explicitly, so an invalid controller is rejected before it creates
pods. Container UID overrides cannot select zero even when pod-level
`runAsNonRoot=true`. Effective numeric UID must be positive, avoiding ambiguity
from image USER names. Writable `/tmp`/cache volumes remain permitted with bounds.

All hostPath volumes are forbidden in application namespaces, including `/`,
`/etc`, kubelet paths and runtime sockets. Privileged mode, host networking,
hostPID/hostIPC, privilege escalation, added capabilities and unconfined seccomp
are rejected. Ephemeral containers must follow security controls but are excluded
from resource fields because Kubernetes does not permit ephemeral resources.

Policies match the fixed `asteriq-dev`, `asteriq-staging` and
`asteriq-production` namespace names. They do not depend on labels an application
writer could remove. Image/Service/Ingress restrictions are production scoped;
local development can use local images. Replace the **demo account, Region and
repository pattern** in `images.yaml` with reviewed production values before
activation. Zero-digest demo renders intentionally fail that production policy.

The TLS policy accepts canonical HTTPS-only listener JSON, or the canonical
HTTP-80/HTTPS-443 list with a 443 redirect. Alternate formatting is rejected
until reviewed; extra HTTP ports are denied. Certificates remain AWS ACM on ALB.
Restrict who can create/modify Ingress, namespace, admission policies and role
bindings. These policies do not protect other namespaces by default.

## RBAC and service accounts

Frontend, API, AI and migration have separate service accounts with token
automount disabled. They do not need Kubernetes API access and therefore have
**no runtime RoleBinding**. A Kubernetes Secret mounted by kubelet does not
require giving the application Secret read/list permission. IRSA's projected
STS token is separate from a Kubernetes API service-account token.

The support group receives only get/list/watch on workloads, Services, events,
HPA and network objects plus get on pod logs. It cannot read Secrets, exec/attach,
create pods, issue tokens, patch Deployments or impersonate identities. Configure
`asteriq:production:support-readonly` through the intended identity provider/EKS
access entry; manifests do not create or authenticate people.

The optional image-rollout role patches only the three existing Deployments.
**Workload write access can expose mounted application credentials**, even when
the role cannot directly get Secrets. Give it only to trusted release automation;
it is not an image-field-only restriction and does not provision new Deployments
or migration Jobs. Namespace-scoped EKS Edit remains broader than this example
and must be restricted to trusted release principals. Support does not receive it.

Platform operators install admission engines/CRDs and manage system namespaces.
Keep break-glass cluster administration separate, require short-lived SSO/MFA
or OIDC roles, and audit role assumptions. Kubernetes RBAC is additive: review
all effective ClusterRoleBindings, not just these namespaced examples.

## Network, Pod Security and resources

Canonical `network-policies/application.yaml` starts with deny-all ingress and
egress, then allows DNS, frontend-to-API, API-to-AI and authenticated AI callbacks.
Environment policies add ALB subnet ingress and managed data-service ports.
Private AWS endpoints require the additive example in
`infrastructure/eks/platform/aws-endpoint-networkpolicy.example.yaml` at the
repository root. Port/IP rules cannot prove the identity of a remote hostname.

Ensure the CNI actually enforces NetworkPolicy. DNS rules assume CoreDNS rather
than NodeLocal DNS; adapt and test if NodeLocal DNS is installed. Monitoring
scrapes and OTLP need their existing narrowly scoped allowance profiles.
Use connectivity tests from permitted and unrelated pods before production.
NetworkPolicy does not encrypt traffic or isolate IAM/database identities.

Application namespaces already enforce **Restricted Pod Security Standards**,
with audit/warn also Restricted. The namespace policy prevents downgrade.
Current labels use `latest`; pin them to a tested Kubernetes minor during real
cluster rollout and review changes on upgrades. PSA covers additional controls
such as host ports/sysctls/volume types alongside the explicit Kyverno rules.

Production Kustomize now includes support RBAC, disabled default token automount,
quota and LimitRange. The quota accommodates HPA maxima plus surge: 64 requested
CPUs/96Gi memory, 128 CPU/192Gi limits and 80 pods, with bounded Secret/PVC counts.
These are starting budgets, not cost or performance guarantees. Namespace quota
does not create node capacity. Apply these resources separately for Helm-owned
workloads; do not have two reconcilers own the same resource.

Fluent Bit/Alloy collectors live in `logging-agents`, need root and host log
mounts, and do not meet application Restricted standards. Do not move application
pods there to bypass policies. Do not broadly exempt an application namespace or
service account; approved platform exceptions need precise resources, an owner,
reason, expiry and compensating controls.

## Secrets and TLS

Use the existing External Secrets Operator SecretStore and exact IRSA trust to
read only environment application secrets. Values are populated outside source
control/Terraform. EKS KMS encrypts Kubernetes Secrets; base64 is not encryption.
Restrict Secret writers/readers, workload writers and exec access, and test
rotation with application reload/restart. Application secret readers cannot read
the RDS administrator credential. Keep migration credentials separate.

TLS is configured for CloudFront/ALB, RDS, Redis, external LLM and SMTP STARTTLS.
Use verified CA/hostname validation for database/Redis clients, never
`rejectUnauthorized=false`, `CERT_NONE` or an insecure client override. The
current private application HTTP listeners and Collector-to-Tempo gRPC are an
explicit remaining encryption gap.

The internal certificate example uses a CA Secret in cert-manager's system
namespace, separate API/AI keys, service DNS SANs and key rotation. Provision CA
material securely and restrict certificate issuance/approved SANs. Certificates
alone do not convert Node/FastAPI listeners to HTTPS: configure TLS listeners or
mTLS proxies, update Service ports/URLs and client trust, and verify peer names.
Do not claim full in-cluster TLS from an Ingress annotation or NetworkPolicy.

## Trivy and CI

Existing image build/promotion workflows fail HIGH/CRITICAL CVEs, including
unfixed findings, and scan dependency/secrets data. The new
`.github/workflows/kubernetes-security.yml` at repository root installs a
checksum-pinned Kyverno CLI, tests policies against allowed/denied fixtures and
actual rendered Helm Deployments, then runs a Trivy rendered-manifest gate.
Actions are pinned to commit SHAs; the job has read-only repository permissions
and no cloud credentials. It does not publish images or apply cluster resources.

For a real approved image, scan the exact digest and retain the report:

```powershell
trivy image --scanners vuln,secret --severity HIGH,CRITICAL --exit-code 1 --format json --output image-security.json YOUR_APPROVED_IMAGE_AT_SHA256
```

Do not scan a tag and deploy a different digest. Vulnerability DB refresh,
scanner failures and policy failures must fail the release gate. Exceptions
must identify the specific CVE/resource, owner and expiry; do not globally ignore
HIGH findings or unfixed CVEs. ECR publisher restrictions and trusted signed
scan attestations are needed to prevent bypass by an untrusted registry writer.
These examples do not implement signature/attestation verification.

## Local verification and rollout

```powershell
# KYVERNO_BIN can point to an installed, verified Kyverno 1.19.1 executable.
python -m pytest scripts/kubernetes/tests/test_security_policies.py -q
python scripts/kubernetes/demo_eks.py
trivy config --severity HIGH,CRITICAL --exit-code 1 .runtime/eks-demo.yaml
kubectl kustomize k8s/security/kyverno
kubectl kustomize k8s/security/rbac
kubectl kustomize k8s/security/limits
```

All commands above are local except a Trivy check/database download. No cluster
access is required. Local review used checksum-verified Kyverno/Trivy archives
and Trivy embedded misconfiguration checks without a remote check update.

For a future cluster, install a compatible Kyverno chart/CRDs with an HA admission
controller, disruption budget and monitored webhook certificates. Verify API
server-to-webhook connectivity, policy readiness, policy reports and fail-closed
behavior. Policies must be installed before untrusted writers get access; existing
violating pods are reported, not automatically terminated.

Review existing workloads in staging, replace registry placeholders, and use
explicit kubeconfig contexts with server-side dry-run and controlled negative
tests. Apply Deny policies only after confirming platform agents stay outside
application scopes. Ordinary application identities must not edit policies,
exceptions, namespaces or bindings. Test outage/break-glass procedures without
creating a permanent fail-open bypass.

Verify effective authorization, for example with a trusted administrator:

```powershell
kubectl --context YOUR_CONTEXT auth can-i get pods -n asteriq-production --as=review-user --as-group=asteriq:production:support-readonly
kubectl --context YOUR_CONTEXT auth can-i get secrets -n asteriq-production --as=review-user --as-group=asteriq:production:support-readonly
kubectl --context YOUR_CONTEXT auth can-i create pods/exec -n asteriq-production --as=review-user --as-group=asteriq:production:support-readonly
```

Expect yes/no/no, respectively. The reviewer needs impersonation permission;
do not grant it to support merely to run checks. A real cluster audit must also
inspect inherited bindings, webhook availability, CNI enforcement, image
provenance, IAM trust and live TLS—not only manifest defaults.

References: [Kubernetes RBAC guidance](https://kubernetes.io/docs/concepts/security/rbac-good-practices/),
[Service accounts](https://kubernetes.io/docs/concepts/security/service-accounts/),
[Kyverno ValidatingPolicy](https://kyverno.io/docs/policy-types/validating-policy/),
[Kyverno policy testing](https://kyverno.io/docs/guides/testing-policies/),
[Trivy misconfiguration scanning](https://trivy.dev/docs/latest/scanner/misconfiguration/).
