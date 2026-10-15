# EKS application secrets

AWS Secrets Manager → External Secrets Operator (ESO) → namespaced Kubernetes
Secret → API, AI or migration pod environment. The frontend receives no credentials.
This is an account-free implementation; no values, AWS resources or live sync have
been created by these examples.

| Secrets Manager suffix | Kubernetes Secret/key | Consumer |
| --- | --- | --- |
| database-url | api-secrets / DATABASE_URL | API database identity |
| redis-url | api-secrets / REDIS_URL | API Redis identity |
| jwt | api-secrets / JWT_ACCESS_SECRET | API signing key |
| smtp | api-secrets / SMTP_URL | API email delivery |
| rag-database-url | ai-service-secrets / RAG_DATABASE_URL | AI database identity |
| openai | ai-service-secrets / OPENAI_API_KEY | AI LLM client |
| migration-database-url | migration-secrets / DATABASE_URL | Migration job only |

Each AWS secret contains a raw string, not a JSON object. Populate values through
Secrets Manager's console using a privileged, audited operator session. Never put
values in manifests, Helm values, Terraform inputs, command arguments, shell
history, tickets or Git. Terraform creates secret containers only, without secret
versions, and uses AWS-managed Secrets Manager encryption. Database URLs must
use separate least-privilege identities and verified TLS; Redis uses rediss;
SMTP credentials must use the configured SES TLS transport. JWT requires a
cryptographically random signing key of at least 32 characters.

## Bootstrap with an AWS account

1. Apply the reviewed EKS foundation from `infrastructure/eks/foundation` using
   the private administration path. Its IRSA policy grants only GetSecretValue
   and DescribeSecret on the seven exact application ARNs, excluding RDS admin.
   The OIDC trust pins this cluster, audience sts.amazonaws.com and the exact
   `asteriq-ENV:secrets-reader` service account. No AWS access keys are needed.
2. Install a reviewed, version-pinned ESO chart and its v1 CRDs in an operator
   namespace. Restrict its watched namespaces and disable unused cluster stores,
   cluster external secrets and push secrets according to that chart's options.
   The controller needs Secret reconciliation RBAC and TokenRequest permission
   (`create` on `serviceaccounts/token`) for the named secrets-reader account.
   Verify the generated RBAC; the reader itself requires no application RBAC.
3. Populate the seven AWS values out of band. Replace region, account, namespace
   and IRSA metadata in the environment's `aws-settings.yaml` or the standalone
   `infrastructure/eks/platform/external-secrets.example.yaml`. Use either the
   environment Kustomization or standalone resources, not both ownership paths.
   The IAM example requires exact full secret ARNs, including AWS's random suffix.
4. Apply the namespace-scoped SecretStore and ExternalSecrets. Allow the ESO
   controller to reach Kubernetes API, regional STS and Secrets Manager over TLS,
   including their PrivateLink endpoints. Restrict who may edit SecretStores,
   ExternalSecrets, service accounts, Secrets and workloads or use pod exec.
5. Check readiness before starting workloads:

```sh
kubectl -n asteriq-production wait --for=condition=Ready secretstore/aws-secrets --timeout=120s
kubectl -n asteriq-production wait --for=condition=Ready externalsecret/api-secrets externalsecret/ai-service-secrets externalsecret/migration-secrets --timeout=120s
```

Do not print Kubernetes Secret YAML or decode values during checks. Kubernetes
Secret base64 is not encryption. The EKS foundation enables KMS envelope
encryption; namespace readers and workload editors still need strict access
controls. API and AI pod IRSA roles have S3 permissions, not Secrets Manager reads.
If using a customer-managed Secrets Manager key, add narrowly scoped kms:Decrypt
and a matching key policy before switching encryption; this example uses aws/secretsmanager.

## Rotation and failure handling

ESO periodically refreshes every five minutes. Retain preserves the last synced
Secret if a provider value disappears; investigate SecretSyncedError rather than
treating stale credentials as healthy. Owner means deleting the ExternalSecret
can garbage-collect its Kubernetes Secret: deletionPolicy is not deletion protection.
AWS production secret containers have a 30-day recovery window.

Rotate credentials at the database, Redis, LLM or SMTP provider first with a
tested overlap/cutover procedure, then update Secrets Manager's AWSCURRENT value.
Wait for successful ESO refresh, then perform controlled rolling restarts of API
and/or AI deployments and validate connectivity without logging credentials.
Environment variables in running pods do not refresh automatically. Migration
jobs consume the latest value at job creation. The current API supports one JWT
signing key; replacing it invalidates existing access tokens. Plan a maintenance
cutover or implement a key ring before claiming seamless JWT rotation.

Audit AWS secret access with CloudTrail, restrict secret editors separately from
readers, and monitor ESO reconciliation failures. Never log environment dumps,
Authorization headers, database URLs or SMTP URLs. Ignore files are convenience,
not a security boundary; retain repository secret scanning in CI.

References: [ESO AWS IRSA](https://external-secrets.io/latest/provider/aws-secrets-manager/)
and [refresh behavior](https://external-secrets.io/latest/api/externalsecret/).
