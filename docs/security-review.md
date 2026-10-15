# Asteriq AI security design review

Review date: 10 October 2026. Scope: React frontend, Node API, FastAPI AI service,
SQL migrations, Docker images, GitHub deployment workflows, Terraform, and IAM templates.

**Assessment: resolve the High findings before production approval.** No Critical
vulnerability was confirmed. This is a source and design review, not a penetration
test or verification of an AWS account. Infrastructure in this repository has not
been deployed. Account-level policies, actual secret contents, database grants,
DNS, and production environment approvals could not be verified.

The application currently implements **paper trading**, not custody, withdrawals,
or execution with real money. Severity reflects account confidentiality, integrity,
availability, and the proposed production deployment; it does not imply that an
attacker can withdraw real funds.

Frameworks: [OWASP Top 10:2025](https://owasp.org/Top10/2025/),
[OWASP API Security Top 10:2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/),
and the [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/framework/security.html).
Mappings below are review classifications, not certifications.

## Findings summary

| Severity | Count       | Meaning                                                                          |
| -------- | ----------- | -------------------------------------------------------------------------------- |
| Critical | 0 confirmed | No demonstrated unauthenticated system takeover or equivalent impact             |
| High     | 6           | Material account or availability exposure, or a privileged production design gap |
| Medium   | 9           | Abuse, isolation, hardening, or operational gaps with additional prerequisites   |
| Low      | 2           | Defense improvements and reproducibility gaps                                    |

| ID  | Severity | Finding                                                                             | Evidence status                                                     |
| --- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| H01 | High     | Suspended users retain active-session access                                        | Confirmed code behavior                                             |
| H02 | High     | Proxy trust misattributes client IPs and shares rate-limit buckets                  | Confirmed with local proxy-chain reproduction                       |
| H03 | High     | Recovery tokens enter access-log URLs                                               | Confirmed design; exploitation needs log access and an unused token |
| H04 | High     | Deployment migrations reuse the runtime database identity                           | Confirmed wiring; excessive runtime grants are deployment-dependent |
| H05 | High     | Privileged application actions have no MFA or step-up authentication                | Confirmed design gap                                                |
| H06 | High     | WebSocket authentication outlives the access JWT                                    | Confirmed code behavior; exploitation needs a valid/stolen token    |
| M01 | Medium   | AI work has no distributed per-user quotas or bounded admission queue               | Confirmed code gap                                                  |
| M02 | Medium   | WebSocket origin enforcement and connection admission are incomplete                | Confirmed code gap; JWT authentication remains present              |
| M03 | Medium   | Static frontend lacks browser security headers                                      | Confirmed configuration gap; no exploitable XSS sink found          |
| M04 | Medium   | Security audit coverage and tamper resistance are incomplete                        | Confirmed source gaps; live grants unknown                          |
| M05 | Medium   | Internal TLS and database certificate verification are not enforced end to end      | Confirmed configuration gap; actual secret URLs unknown             |
| M06 | Medium   | Both application task roles have full shared object-bucket access                   | Confirmed IAM policy scope                                          |
| M07 | Medium   | Security detection and notification require unimplemented account setup             | Deployment-dependent; account controls unverified                   |
| M08 | Medium   | Web container starts as root; ECS lacks explicit capability/filesystem restrictions | Confirmed configuration gap                                         |
| M09 | Medium   | Refresh rotation extends sessions without an absolute lifetime                      | Confirmed code behavior                                             |
| L01 | Low      | JWT required claims and signing-key rotation need stronger policy                   | Defense improvement; no signature bypass found                      |
| L02 | Low      | Docker bases and Python dependency artifacts are not fully pinned                   | Confirmed reproducibility gap; no CVE claim made                    |

## Existing controls and coverage

| Area requested      | Observed controls and review result                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication      | bcrypt cost 12, minimum password length, bcrypt byte-length checks, verified-email login, recovery-token hashing and expiry. Address H01/H05/M09.                                                                                                                             |
| Authorization       | Private routes authenticate first; admin routes load database roles; owner predicates protect watchlists, orders, notifications, portfolios, and RAG documents. No confirmed cross-user object access found in reviewed paths.                                                |
| JWT                 | HS256 algorithm allowlist, issuer/audience checks, ten-minute access tokens, active-session checks, hashed opaque refresh tokens, transactional rotation and reuse revocation. Address H06/L01.                                                                               |
| API security        | Strict Zod/Pydantic input schemas, pagination and body limits, generic client errors, read-only evidence retrieval, bounded provider retries. Address M01/M04.                                                                                                                |
| SQL injection       | Reviewed Node queries bind `$1` parameters and Python queries bind `%s` values, including vector searches. No confirmed SQL injection found. Keep dynamic identifiers allowlisted if introduced.                                                                              |
| XSS                 | React renders text; no `dangerouslySetInnerHTML` found in reviewed frontend paths. Citation links restrict HTTP/HTTPS and use `noreferrer`. Address M03.                                                                                                                      |
| CSRF                | Access authentication uses bearer headers. Web refresh cookies are HttpOnly, Secure in production, SameSite Strict, and path-restricted; auth writes enforce allowed origins. No confirmed CSRF bypass found.                                                                 |
| CORS                | Exact origin allowlist with credentials; unknown browser origins rejected. Requests without Origin are intentionally allowed for non-browser bearer clients. CORS is not authorization.                                                                                       |
| Rate limiting       | Redis-backed HTTP/auth limits plus account lockout. Proxy attribution breaks isolation in the proposed topology; expensive work needs separate budgets. H02/M01.                                                                                                              |
| WebSockets          | JWT handshake, database/Redis session checks every 15 seconds, server-derived user rooms, 64 KiB message bound, subscription caps. Address H06/M02.                                                                                                                           |
| Docker              | API and Python run as non-root; production images have health checks; CI scans images before publishing. Address M08/L02.                                                                                                                                                     |
| Secrets             | Secret values are provisioned outside Terraform; Redis uses an ephemeral/write-only input; production secrets enter ECS through scoped execution roles. No real credentials were identified in reviewed source; this was not a complete history/secret scan. Address H03/L01. |
| Database encryption | RDS storage encryption and forced SSL, Redis at-rest encryption and required TLS, private data subnets. Verify client certificate checks and runtime roles. H04/M05.                                                                                                          |
| AWS IAM             | Separate task/execution roles, scoped secret/ECR/log permissions, account restrictions, GitHub OIDC subjects scoped to main/production. Address M06 and verify external deployment-role configuration.                                                                        |
| Logging             | JSON API logs include request ID, path, status, and latency without request bodies; Python errors suppress input details. Access-log query strings remain sensitive. H03/M07.                                                                                                 |
| Audit trails        | Append-only UPDATE/DELETE triggers and registration/login success events exist; order ledger writes are transactional. Coverage and independent retention are incomplete. M04.                                                                                                |

The caller-supplied `x-client-type: mobile` header is not an identity proof.
However, the mobile refresh path requires a body token rather than the web cookie,
and a cross-origin browser request with that custom header must pass preflight.
Its presence alone does **not** demonstrate CSRF or HttpOnly-cookie theft.

Examples below illustrate remediation patterns. They require integration,
configuration, and regression tests; they have not been applied to application code.

## H01 — Suspended users retain active-session access

**Evidence:** [AuthService.assertSessionActive](../apps/api/src/auth/service.ts)
checks session ownership, revocation, and expiry but does not join `users` or check
`status = 'ACTIVE'`. Login and refresh do check status. The schema supports
`SUSPENDED` and `DELETED`.

**Risk:** Suspending an account does not consistently revoke authorization.
**Attack scenario:** A user signs in, an operator suspends the account without
revoking its sessions, and the user continues accessing private APIs until the
access token expires. An existing socket can persist much longer under H06.

**Remediation:** Require an active user on every session check. Make suspension
and session revocation one transaction, audit it, and disconnect existing sockets.

**Example implementation:** Replace the active-session query, retaining bound parameters:

```sql
SELECT s.last_seen_at
FROM sessions s JOIN users u ON u.id = s.user_id
WHERE s.id = $1 AND s.user_id = $2
  AND s.revoked_at IS NULL AND s.expires_at > now()
  AND u.status = 'ACTIVE';
```

**Mapping:** OWASP A01/A07; API2/API5; AWS strong identity foundation.

## H02 — Proxy trust shares client rate-limit buckets

**Evidence:** [app.ts](../apps/api/src/app.ts) uses `trust proxy = 1`;
[Nginx](../infrastructure/docker/nginx.conf) appends its ALB peer to
`X-Forwarded-For`. The path is client → ALB → Nginx → API.
Local `proxy-addr` reproduction returned ALB address `10.22.0.10`, rather than
client `198.51.100.42`, when trusting one hop.

**Risk:** Clients behind an ALB node share HTTP/auth rate-limit buckets; session
IP attribution is inaccurate.
**Attack scenario:** An attacker exhausts ten login attempts against arbitrary
addresses, causing other clients routed through the same ALB node to receive
rate-limit errors for the 15-minute login window. API limits can similarly affect
unrelated users. This is not evidence of arbitrary IP spoofing on the fixed path.

**Remediation:** Trust precisely the two protected proxy hops, or preferably
configured proxy-subnet ranges. Ensure no shorter path can directly reach the API,
and re-evaluate the chain when adding CloudFront. Test spoofed forwarded headers.

**Example implementation:** Valid for the current fixed, SG-restricted two-hop path:

```ts
app.set('trust proxy', 2);
// Regression: XFF "client, ALB" with Nginx as peer resolves to client.
// Regression: a client-prepended fake address never becomes request.ip.
```

**Mapping:** OWASP A02/A06; API4/API8; AWS defense in depth.

## H03 — Recovery tokens are exposed to access-log readers

**Evidence:** [auth/service.ts](../apps/api/src/auth/service.ts) generates
`/reset-password?token=...` and `/verify-email?token=...` links.
[ALB access logging](../infrastructure/terraform/modules/alb/main.tf) is enabled;
the Nginx configuration does not replace its default request-URL logging.

**Risk:** URL-bearing logs and browser history contain usable one-time secrets.
**Attack scenario:** An attacker with access to a copied ALB/Nginx log redeems an
unused reset token within its 30-minute lifetime and takes over the account.
Token hashing in the database does not protect the plaintext URL in access logs.

**Remediation:** Put recovery secrets in URL fragments, parse them only in the
frontend, immediately remove them from history, and send them in a POST body.
Avoid token-bearing page analytics and enforce restrictive log access/retention.
Until migrated, sanitize Nginx logs and restrict ALB logs; Nginx sanitization does
not remove the query string already recorded by the ALB.

**Example implementation:**

```ts
const link = `${env.AUTH_WEB_URL}/reset-password#token=${encodeURIComponent(token)}`;
// Frontend recovery page: fragments are not sent in HTTP request URLs.
const tokenFromLink = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
// Submit tokenFromLink with the new password in the existing POST JSON body.
```

**Mapping:** OWASP A07/A09; API2/API8; AWS protect data and enable traceability safely.

## H04 — Migration and runtime database privileges are coupled

**Evidence:** [deploy_ecs.py](../scripts/ci/deploy_ecs.py) starts migrations from
the registered API task definition, overriding its command only. It inherits the
same `DATABASE_URL`, task role, and execution role as the runtime API.
Database roles/grants are not provisioned by these migrations or Terraform.

**Risk:** Granting that credential schema-owner/DDL rights to make automated
migrations work also grants those rights to a compromised API. Conversely, a
properly restricted runtime role can cause deployment migrations to fail.
Actual excessive production grants were not verified.

**Attack scenario:** After API code execution, an attacker using a schema-owner
runtime credential disables audit/ledger triggers, alters tables, or truncates
records. This finding's High impact is conditional on the deployed grants.

**Remediation:** Create dedicated runtime, AI, migration, and audit roles. Run a
separate migration task definition with a separate secret and execution role.
Runtime roles must not own tables or have DDL, TRUNCATE, role-management, or
trigger-management privileges.

**Example implementation:** Authentication is configured separately, without passwords in SQL:

```sql
CREATE ROLE asteriq_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO asteriq_api;
-- Grant DML only on the explicit application table inventory.
GRANT SELECT, INSERT, UPDATE, DELETE ON users, user_profiles, sessions TO asteriq_api;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM asteriq_api;
-- Objects must be owned by a distinct migration role, not asteriq_api.
```

Adjust grants for the complete schema and identity sequences; give ledger/audit
tables narrower privileges. Change CD to use `MIGRATION_TASK_DEFINITION_ARN`
instead of the runtime API definition.

**Mapping:** OWASP A01/A08; API5; AWS least privilege and separation of duties.

## H05 — Privileged actions lack MFA and recent authentication

**Evidence:** [auth/service.ts](../apps/api/src/auth/service.ts) implements
password login; [requireRole](../apps/api/src/middleware/rbac.ts) checks role only.
Admin symbol creation and quote publication in
[api.routes.ts](../apps/api/src/routes/api.routes.ts) have no second factor or
recent-authentication requirement.

**Risk:** One stolen admin password/session is sufficient for privileged actions.
**Attack scenario:** Phishing or credential reuse compromises an application admin,
who then changes instrument/quote data affecting displayed valuations and paper trades.
No real-money trading impact is established.

**Remediation:** Require phishing-resistant MFA for application admins, secure
enrollment/recovery, and step-up authentication for privileged mutations. AWS
console MFA does not protect application admin routes.

**Example implementation:** Pattern requiring new server-verified session fields:

```ts
const stepUp = async (req, res, next) => {
  const session = await loadVerifiedSession(req.auth.sessionId);
  if (!session.mfaVerifiedAt || Date.now() - session.mfaVerifiedAt.getTime() > 300_000) {
    return res.status(403).json({ error: { code: 'STEP_UP_REQUIRED' } });
  }
  next();
};
router.post('/market/symbols', authenticated, admin, stepUp, validated, handler);
```

Verify a WebAuthn challenge before setting `mfaVerifiedAt`; never trust a client
header saying MFA was completed.

**Mapping:** OWASP A07; API2/API5; AWS strong identity foundation.

## H06 — WebSockets continue after access-token expiry

**Evidence:** [socket.server.ts](../apps/api/src/socket/socket.server.ts) verifies
the JWT only at connection time. Its 15-second checks validate the session, not
the JWT's expiration. Sessions can last 30 days and are extended by refresh.

**Risk:** The ten-minute access-token lifetime does not bound socket access.
**Attack scenario:** A stolen access token is used before expiry to open a socket.
The attacker continues receiving user notifications while the underlying session
remains active, even after the token can no longer authenticate HTTP requests.

**Remediation:** Record the verified `exp`, disconnect at expiry, and require an
authenticated reconnect with a fresh token. Keep session/status checks and user-room
authorization. If recovery is introduced, do not skip authentication middleware.

**Example implementation:** Extend `verifyAccessToken` to return verified expiry:

```ts
const ttl = identity.expiresAtMs - Date.now();
if (ttl <= 0) return next(new Error('unauthorized'));
const expiryTimer = setTimeout(() => socket.disconnect(true), ttl);
expiryTimer.unref();
socket.once('disconnect', () => clearTimeout(expiryTimer));
```

**Mapping:** OWASP A07; API2; AWS identity lifecycle management.

## M01 — AI abuse limits are local, not user-budgeted

**Evidence:** [rag.py](../apps/ai-service/app/services/rag.py) uses a process-local
semaphore, which waits without a bounded queue. [research_assistant.py](../apps/ai-service/app/services/research_assistant.py)
limits concurrent generation per process. The API applies a general 300/minute IP
limit, without per-user provider-spend, ingestion-byte, or storage quotas. PDF
character limits are checked after extraction work has begun.

**Risk:** A valid user can consume paid embeddings/storage and monopolize workers;
multiple tasks multiply the available work allowance.
**Attack scenario:** A user submits distinct maximum-size documents and repeated
questions from several clients. Waiting requests consume memory, while embedding
calls and stored chunks incur cost. A computationally expensive PDF stalls parser
workers despite compressed-file/page bounds.

**Remediation:** Add Redis-backed atomic user/tenant budgets, bounded admission,
per-document processing deadlines, and killable parser isolation. Enforce storage
and daily token/byte quotas before provider calls. Keep existing provider timeouts.

**Example implementation:** Pattern for an atomic Redis reservation service:

```ts
const accepted = await quota.reserve({
  userId: req.auth.userId,
  operation: 'document-ingest',
  bytes: Buffer.byteLength(req.body.content),
  maxDailyBytes: policy.maxDailyBytes,
});
if (!accepted) return res.status(429).json({ error: { code: 'BUDGET_EXCEEDED' } });
// reserve must use atomic Redis operations; release reservations on rejected work.
```

Use a bounded worker queue and a subprocess/container with memory and wall-clock
limits for PDF extraction; merely timing out an await does not stop a worker thread.

**Mapping:** OWASP A06/A10; API4/API6; AWS resource and cost protection.

## M02 — WebSocket admission needs origin and connection controls

**Evidence:** [socket.server.ts](../apps/api/src/socket/socket.server.ts) configures
CORS but no explicit Engine.IO `allowRequest`. It limits subscriptions per socket,
not active connections per user/IP across replicas. Every connection adds database
and Redis work, including periodic checks and subscription heartbeats.

**Risk:** Token holders can create many connections and reset per-socket limits.
**Attack scenario:** A legitimate abusive account opens thousands of sockets across
API tasks, increasing session-check queries and room/heartbeat state. An unexpected
browser origin can attempt WebSocket connections; it still needs a valid JWT.
This is not a demonstrated cookie-only cross-site WebSocket hijack.

**Remediation:** Validate browser origins explicitly at handshake, define a separate
policy for Origin-less native clients, and implement atomic distributed user/IP
connection leases with TTL, cleanup, and per-user event limits.

**Example implementation:** Browser-origin gate; JWT authentication remains mandatory:

```ts
allowRequest(req, callback) {
  const origin = req.headers.origin;
  callback(null, typeof origin === 'string' && corsOrigins.includes(origin));
}
```

Add a documented native-client exception when necessary; do not treat absence of
Origin or `x-client-type` as authentication. Reserve/release Redis connection leases
in connection middleware and disconnect cleanup.

**Mapping:** OWASP A02/A06; API4/API8; AWS layered protection.

## M03 — Static frontend browser headers are missing

**Evidence:** [Nginx](../infrastructure/docker/nginx.conf) serves React documents
without CSP, HSTS, frame protection, or a referrer policy. `helmet()` protects API
responses and does not cover the separately served HTML.

**Risk:** A future XSS or dependency compromise has fewer browser restrictions;
pages may also be framed for clickjacking.
**Attack scenario:** An introduced HTML injection executes in the application
origin and accesses the in-memory bearer token or invokes authenticated actions.
No such exploitable injection was identified in the current text-rendering paths.

**Remediation:** Set headers on HTML at Nginx/CloudFront, deploy CSP in report-only
mode first, then enforce it. Preserve escaped rendering and validate future Markdown
renderers. HSTS is for the public HTTPS deployment, not local development.

**Example implementation:** Adapt connection/style directives to actual assets:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self' wss://production.example.com; style-src 'self' 'unsafe-inline'" always;
add_header Strict-Transport-Security "max-age=31536000" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Content-Type-Options "nosniff" always;
```

Remove inline-style allowance where practical; account for chart-generated styles
and the exact WebSocket hostname before enforcement.

**Mapping:** OWASP A02/A05; API8; AWS defense in depth.

## M04 — Audit trails miss important security events

**Evidence:** Audit insertion is present for registration/login success in
[auth/service.ts](../apps/api/src/auth/service.ts). No callers of `writeAudit`
were found for logout, reset, replay detection, role denial, admin mutations, or
document deletion. Request IDs/IP columns are not populated by the observed auth
inserts. [Schema triggers](../database/migrations/001_initial_schema.sql) reject
UPDATE/DELETE, but do not address TRUNCATE or a privileged owner disabling triggers.

**Risk:** Investigations cannot reliably reconstruct account changes and privileged
actions; database-local records alone are not independently tamper-resistant.
**Attack scenario:** An attacker resets a password, revokes sessions, changes market
data, or deletes documents without an attributable security event. An overprivileged
database identity can erase evidence; H04 increases this risk.

**Remediation:** Define an event catalog, log failures/replay and state changes,
populate server-derived actor/request/IP/outcome fields, and commit successful
mutation events in the same transaction. Restrict audit-table privileges and export
to an independently controlled immutable archive with a defined retention policy.

**Example implementation:** Inside the mutation's existing transaction:

```sql
INSERT INTO audit_logs
  (actor_user_id, action, entity_type, entity_id, outcome, request_id, ip_address)
VALUES ($1, 'ORDER_SUBMITTED', 'order', $2, 'SUCCESS', $3, $4::inet);
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM asteriq_api;
```

The role must not own the table. Log denied events outside rolled-back mutation
transactions through a reliable security-event channel. Never include credentials.

**Mapping:** OWASP A08/A09; API5/API8; AWS enable traceability.

## M05 — Transport peer verification is configuration-dependent

**Evidence:** ALB targets use HTTP; web/API and API/AI URLs use HTTP. Node's
[Pool](../apps/api/src/server.ts) and Python's [PgVectorStore](../apps/ai-service/app/services/rag_store.py)
take secret-provided connection strings without enforcing production CA verification.
RDS forces SSL and Redis requires TLS, so this is not a finding of unencrypted RDS
storage or universally plaintext database connections.

**Risk:** Private network location substitutes for cryptographic service identity;
an incorrectly configured database URL can provide encryption without certificate
verification.
**Attack scenario:** A compromised internal proxy/routing or DNS configuration
redirects bearer traffic or a database client to an impersonating endpoint. Exploitation
requires control of a trusted internal path/configuration, not merely another VPC task.

**Remediation:** Require verified TLS for PostgreSQL/Redis and provision CA bundles.
Use HTTPS ALB targets and authenticated internal TLS where the fintech policy
requires it. Test wrong-host/wrong-CA rejection and document any accepted exception.

**Example implementation:** Python connection policy independent of secret URL defaults:

```python
await psycopg.AsyncConnection.connect(
    dsn, sslmode="verify-full", sslrootcert="/etc/ssl/certs/rds-ca-bundle.pem",
    connect_timeout=5,
)
```

Apply equivalent Node TLS policy, ensuring URL SSL options cannot override it.
Internal HTTPS also requires application-side listeners/certificates; changing the
ALB protocol alone is insufficient.

**Mapping:** OWASP A04; API8; AWS protect data in transit.

## M06 — Shared S3 permissions expand service compromise impact

**Evidence:** [ECS storage policy](../infrastructure/terraform/modules/ecs/main.tf)
grants both API and AI task roles `ListBucket`, `GetObject`, and `PutObject` over
the entire object bucket. Current RAG storage is PostgreSQL; the S3 grant is broader
than that feature currently needs.

**Risk:** A compromised task can read/overwrite other services' objects and all
tenants' objects in that bucket. A bucket is private to the internet but not isolated
between the two authorized task identities.
**Attack scenario:** AI-service code execution uses its role credentials to list and
replace sensitive reports outside its required storage scope. No current user-facing
S3 object-authorization bypass was identified.

**Remediation:** Remove unused S3 rights. When storage integration is added, assign
service prefixes/access points and exact actions. Enforce tenant ownership in the
application before issuing presigned URLs; shared service roles do not inherently
provide per-user isolation.

**Example implementation:** Restrict a role that actually needs research output:

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::ENVIRONMENT_OBJECT_BUCKET/research-output/*"
}
```

Remove `ListBucket` unless needed; if retained, constrain `s3:prefix` to the same
scope. Use verified ownership metadata for every document download.

**Mapping:** OWASP A01; API1/API5; AWS least privilege and data protection.

## M07 — Account security telemetry and alarm delivery are unresolved

**Evidence:** Terraform creates logs, flow logs, operational alarms, and an SNS
topic, but no subscription, CloudTrail trail, or security-specific detection rules.
The runbook explicitly leaves account auditing and subscription setup external.
Actual organization-level trails, GuardDuty, and subscriptions were not inspected.

**Risk:** A deployed stack can have alarms without human notification and lack
evidence of IAM/secret/state access unless external account controls are configured.
**Attack scenario:** A compromised deployment role reads secrets or changes task
definitions; no configured security detector alerts responders promptly.

**Remediation:** Verify an organization/account trail with protected retention and
appropriate S3/Secrets Manager events, enable threat detection according to policy,
subscribe on-call destinations, and alert on authentication abuse, token replay,
privileged mutations, and unusual secret/state access. Test delivery.

**Example implementation:** Notification subscription with a required confirmation step:

```hcl
resource "aws_sns_topic_subscription" "security_oncall" {
  topic_arn = module.cloudwatch.alarm_topic_arn
  protocol  = "email"
  endpoint  = var.security_oncall_email
}
```

Use your established paging integration in production. A subscription alone does
not implement CloudTrail or security-event detection.

**Mapping:** OWASP A09; API8; AWS traceability and incident preparation.

## M08 — Web container and task isolation need hardening

**Evidence:** [web.Dockerfile](../infrastructure/docker/web.Dockerfile) has no
runtime `USER`, and the standard Nginx image starts its master as root. API/Python
already use non-root users. [ECS definitions](../infrastructure/terraform/modules/ecs/main.tf)
do not explicitly set read-only root filesystems or drop Linux capabilities.

**Risk:** Code execution has more local privilege and writable persistence paths
than necessary. Fargate isolation remains a control; container root alone does not
demonstrate a host escape.
**Attack scenario:** An Nginx/dependency exploit writes modified files or uses
unnecessary container capabilities to strengthen foothold and access task secrets.

**Remediation:** Use a non-root Nginx setup, drop capabilities, use read-only roots,
and supply explicit writable volumes for Nginx runtime files, temporary files, and
model caches. Verify all three services under those restrictions.

**Example implementation:** ECS container JSON pattern after configuring paths:

```json
{
  "user": "10001:10001",
  "readonlyRootFilesystem": true,
  "linuxParameters": { "capabilities": { "drop": ["ALL"] } }
}
```

Choose an existing UID per image. The web entrypoint currently writes Nginx
configuration; move that generation to a writable mount or image-build step.

**Mapping:** OWASP A02; API8; AWS minimize attack surface.

## M09 — Sessions have no absolute lifetime

**Evidence:** [AuthService.refresh](../apps/api/src/auth/service.ts) sets the next
session expiration to `now + 30 days` on every successful rotation. It does not
cap expiry relative to `sessions.created_at`.

**Risk:** A continuously refreshed session can persist indefinitely without fresh
authentication, increasing the lifetime of a compromised refresh credential.
**Attack scenario:** A stolen refresh token is rotated by an attacker before the
victim reuses it; the attacker maintains access indefinitely if replay detection is
never triggered. Token rotation does not by itself establish an absolute lifetime.

**Remediation:** Add absolute and idle session lifetimes, require recent MFA for
sensitive actions, and reject refresh once the absolute deadline passes.

**Example implementation:** Include session creation time in the locked query:

```ts
const absoluteExpiry = session.created_at.getTime() + policy.absoluteSessionMs;
const nextExpiry = Math.min(Date.now() + policy.refreshIdleMs, absoluteExpiry);
if (nextExpiry <= Date.now()) throw invalidCredentials();
const newExpiry = new Date(nextExpiry);
```

Choose lifetimes based on account privilege and user experience, rather than
blindly applying the same duration to admins and ordinary users.

**Mapping:** OWASP A07; API2; AWS credential lifecycle management.

## L01 — JWT policy and key rotation need explicit requirements

**Evidence:** [verifyAccessToken](../apps/api/src/auth/service.ts) validates HS256,
issuer, and audience, but does not explicitly require `exp`, `iat`, `sub`, or `sid`.
The issuer currently generates those claims correctly. One injected signing key
is used, with no `kid` or overlap-aware rotation design.

**Risk:** Future trusted issuers may accidentally create tokens without expiry;
key rotation can invalidate all sessions unexpectedly or leave compromised key
material accepted longer than intended. HS256 with a strong secret is not itself
a vulnerability, and no `alg=none` or algorithm-confusion bypass was found.
**Attack scenario:** A future issuance path omits expiry, or an emergency key change
leaves long-lived sockets authenticated because H06 is not fixed.

**Remediation:** Require claims and types, validate UUID identities, specify a
maximum token age, and document key rotation/revocation. If adopting asymmetric
keys, isolate signing authority and distribute verification keys only.

**Example implementation:** Retain the algorithm allowlist:

```ts
await jwtVerify(token, jwtKey, {
  algorithms: ['HS256'],
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  requiredClaims: ['exp', 'iat', 'sub', 'sid'],
  typ: 'JWT',
  maxTokenAge: '10m',
});
```

Add verified `exp` to the returned identity for H06. A key identifier must select
from a trusted bounded key set, never an attacker-supplied URL.

**Mapping:** OWASP A04/A07; API2; AWS identity lifecycle management.

## L02 — Build artifacts are not fully reproducible

**Evidence:** Docker bases use mutable tags such as `node:22-alpine`,
`nginx:stable-alpine`, and `python:3.12-slim`. Python top-level requirements have
versions, but installs do not enforce a complete transitive hash lock.
GitHub actions are SHA-pinned and container scans gate publication, which reduces risk.

**Risk:** A rebuild can change its base or transitive dependency set without a
source change. Scanning checks known vulnerabilities, not provenance or all malicious code.
**Attack scenario:** A changed registry artifact or upstream dependency introduces
unreviewed behavior into a rebuilt release. No currently vulnerable package or
compromised artifact was confirmed in this review.

**Remediation:** Pin reviewed base-image digests, maintain automated update PRs,
use a transitive Python hash lock, and generate SBOM/provenance with an enforceable
verification policy. Do not freeze dependencies indefinitely.

**Example implementation:** Replace placeholders with verified artifacts:

```dockerfile
FROM python:3.12-slim@sha256:VERIFIED_BASE_DIGEST AS dependencies
COPY requirements.lock ./requirements.lock
RUN pip install --require-hashes -r requirements.lock
```

**Mapping:** OWASP A03/A08; AWS secure software delivery.

## Evidence, verification, and next steps

The proxy-address reproduction used synthetic private/public addresses and no
network requests. Focused existing tests passed: Node authentication validation
and RAG gateway tests, 8 passed; Python RAG tests, 12 passed and 2 skipped.
These unit tests do not verify live database grants or production networking.
The initial sandboxed Node invocation failed during loader initialization; the
approved retry outside the sandbox passed. No exploit was run
against a live account, no secrets were retrieved, and application/infrastructure
behavior was not modified by this review.

Before production, validate suspension and socket expiry; fix the proxy chain;
remove recovery tokens from URLs; separate migration credentials; and require
admin MFA. Then close Medium findings with integration tests covering foreign
object IDs, mass assignment, CSRF refresh behavior, rejected origins, login abuse,
parallel refresh replay, spoofed proxy headers, socket floods, audit atomicity,
and wrong database certificates. Test account-level alarm delivery and recovery.

The AI-to-API authentication callback also needs deployment validation: current
Terraform does not set `RESEARCH_BACKEND_URL` and its security groups do not allow
AI → API TCP 3000. The AI default points to loopback. This currently fails closed
and breaks authenticated research; it is a rollout defect rather than an observed
authentication bypass. Configure a narrowly scoped callback route or local token
verification/revocation design without disabling authentication to make it work.
