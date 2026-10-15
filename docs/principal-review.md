# Asteriq AI principal engineering review

Baseline inspection began 10 October 2026; remediation continued 11 October 2026.
The baseline review and plan preceded source changes.

## Scope and evidence

An inventory/content scan covered 334 authored text files across web, mobile,
Node, Python, shared packages, SQL, Redis/Socket.IO workers, Docker, CI/CD,
Terraform/IAM, observability, load scripts, and documentation. Generated dependencies,
caches, model artifacts, compiled output, and private credential contents were
excluded. Critical execution paths received targeted manual inspection. This is
not a claim of line-by-line proof or a live AWS penetration test.

Baseline: lint and workspace TypeScript checks pass. Formatting fails on four IAM
JSON files. The sandbox initially prevents cache-directory traversal; the approved
outside-sandbox retry establishes the actual formatting failure. Docker Engine
is available for disposable integration services. No production system is contacted.

No Critical vulnerability is confirmed. The application handles paper funds.
Severity distinguishes demonstrated code behavior, deployment-dependent risk,
and architectural/product gaps; it does not imply real-money theft.

## Findings

There are 26 baseline findings plus one Medium bundle-size finding discovered
during validation: **0 Critical, 9 High, 13 Medium and 5 Low**. These are review
findings, not a count of still-open vulnerabilities; completion status follows.

| ID  | Severity                  | Evidence and consequence                                                                                                                                                                                          | Remediation phase                                                                                                           |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| H01 | High                      | `auth/service.ts:assertSessionActive` omits users.status; suspension does not deny existing access sessions                                                                                                       | 1: active-user join and regression                                                                                          |
| H02 | High                      | Socket authentication verifies JWT once; periodic checks omit JWT expiry                                                                                                                                          | 1: verified expiry, expiry disconnect, safe client reconnect                                                                |
| H03 | High                      | Production trusts one proxy hop despite ALB→Nginx→API; rate-limit/session IPs become ALB addresses                                                                                                                | 1: explicit topology setting, AWS two-hop configuration, spoof tests                                                        |
| H04 | High                      | `TradingRepository.portfolio` joins only positive positions before summing realized_pnl; fully sold gains disappear                                                                                               | 2: separate all-position realized aggregate and full liquidation regression                                                 |
| H05 | High                      | Basic portfolio read COALESCEs unpriced holdings to zero and ignores quote currency; misstates equity                                                                                                             | 2: fail unavailable valuations explicitly, preserve response contract                                                       |
| H06 | High                      | Terraform omits RESEARCH_BACKEND_URL and AI→API SG rule; authenticated AI research fails closed in AWS                                                                                                            | 4: private callback URL and narrowly scoped rule, Terraform tests                                                           |
| H07 | High, conditional         | Migration task inherits API runtime DATABASE_URL and IAM identities; DDL privileges can leak into runtime                                                                                                         | 4: dedicated task/secret/roles and release validation; live SQL grants still require provisioning                           |
| H08 | High, design gap          | Admin symbol/quote mutations lack MFA/step-up                                                                                                                                                                     | Follow-up: choose factor enrollment/recovery model; do not silently disable admin APIs                                      |
| H09 | High, log access required | Recovery/verification URLs contain bearer secrets in query strings recorded by access logs                                                                                                                        | 3: fragment-based new links and functional browser recovery pages; old tokens age out                                       |
| M01 | Medium                    | Web access token is memory-only without automatic refresh/bootstrap; reload disables private queries and ten-minute expiry breaks requests                                                                        | 3: serialized cookie refresh, reactive session state, cache cleanup                                                         |
| M02 | Medium                    | Malformed/oversized Express JSON reaches generic 500 handling                                                                                                                                                     | 1: safe 400/413 responses without echoing submitted body                                                                    |
| M03 | Medium                    | RAG semaphore permits an unbounded wait queue; many uploaded bodies can accumulate                                                                                                                                | 3: fail-fast bounded admission; process-isolated PDF resource limits remain follow-up                                       |
| M04 | Medium                    | Generated research is not inserted into ai_research while mobile reads only retained research                                                                                                                     | Follow-up: define retention/consent and persistence/idempotency before promising retained generation                        |
| M05 | Medium                    | Total P/L percentage divides realized plus unrealized profit by remaining cost basis; after liquidation interpretation is ambiguous; four-decimal ledger vs eight-decimal cost basis can leave rounding residuals | Follow-up: explicit return/accounting policy and golden reconciliation tests; no silent API semantic change                 |
| M06 | Medium                    | Basic and analytics valuation queries duplicate logic and differ in unavailable-data behavior; market response shape depends on optional MarketDataService wiring                                                 | 2: align failure behavior; follow-up consolidate behind stable contracts                                                    |
| M07 | Medium                    | Mobile enables Socket.IO polling, but ALB stickiness is at web tier rather than API tier                                                                                                                          | 1: WebSocket-only transport with existing REST snapshot fallback                                                            |
| M08 | Medium                    | Docker context excludes .env but not Terraform caches/state/plans or private load-session JSON                                                                                                                    | 4: explicit exclusions, context regression                                                                                  |
| M09 | Medium                    | Root Nginx master/default writable ECS filesystems and mutable base tags expand compromise/reproducibility risk                                                                                                   | Follow-up: non-root web setup and writable-volume inventory before read-only rollout                                        |
| M10 | Medium                    | Audit records cover registration/login but not most revocation/admin/domain events; UPDATE/DELETE triggers do not prevent privileged TRUNCATE/DDL                                                                 | Follow-up: event catalog, transactional audit/outbox and restricted SQL roles/archive                                       |
| M11 | Medium                    | AI CPU-only scaling does not track vendor-wait admission; sockets check DB every 15 seconds; stream failure/invalid-event retention can grow                                                                      | Follow-up: measured admission/backlog scaling, revocation-aware cache, durable poison-event policy                          |
| M12 | Medium                    | Integration tests skip when URLs are absent; proposed Jest/Vitest/Playwright runners are documentation, not installed coverage                                                                                    | 2/4: run real isolated regressions and document remaining coverage; runner migration remains separate                       |
| L01 | Low                       | JWT verifier does not explicitly require exp/iat or UUID identities, although current issuer creates them correctly                                                                                               | 1: explicit claims/types and regression                                                                                     |
| L02 | Low                       | pytest is in Python runtime requirements rather than dev requirements                                                                                                                                             | 4: move test-only dependency, preserve test installation instructions                                                       |
| L03 | Low                       | Shared web UI package has no current source import; dependency scan also flags Expo peer/build packages that are not necessarily unused                                                                           | Follow-up: remove/reuse confirmed unused UI integration only after full dependency review; do not blindly remove Expo peers |
| L04 | Low                       | Environment Terraform main/variables/output wrappers are duplicated; empty Python **init** files and identical base configs are intentional                                                                       | Follow-up: drift checks; preserve separate backends/accounts rather than merging environments                               |
| L05 | Low                       | IAM files fail formatting; some AI/API runbook statements contradict later implemented features                                                                                                                   | 4: format and update changed behavior; retain implementation boundaries                                                     |

Additional production risks already documented in the security review include
database certificate policy, broad shared-bucket task access, missing account-level
audit/paging confirmation, lack of absolute session lifetime, and supply-chain
locking. No new SQL injection, React HTML injection, or broker/real-money path was
confirmed. An import scan is not sufficient evidence to delete dependencies.

## Remediation plan

### Phase 1 — identity and boundary correctness

Require active users on session checks and validated exp/iat/sub/sid JWT claims.
Bound sockets by JWT expiry, apply browser-origin checks while preserving authenticated
Origin-less native clients, and use WebSocket transport with REST fallback on mobile.
Make proxy trust configurable with explicit AWS two-hop topology, preserving the
one-proxy Compose/default deployment. Correct malformed/oversized request handling.
Acceptance: JWT/status/expiry/origin/proxy/body-error regressions, API/mobile types.

### Phase 2 — financial reads

Preserve realized gains from all positions, including closed lots. Reject missing
or unsupported-currency quotes rather than inventing zero valuation. Preserve
existing decimal/string contracts, trading locks, and idempotency. Add real PostgreSQL
tests for full sell, unavailable quotes, and currency mismatch alongside existing
concurrency/rollback tests. No changes to historical migration files or return-policy
denominators without a specified accounting model.

### Phase 3 — client and AI lifecycle

Add serialized web refresh/bootstrap, reactive auth state and cache cleanup; wire
logout; create functional verification/recovery pages with fragment tokens and
legacy-link handling. Bound upstream response reads and reject RAG overload before
queuing work. Preserve cancellation, safe error envelopes, and existing mobile
session/rotation protections. Acceptance: session-race/recovery/helper tests,
browser build and Python provider/RAG regression checks.

### Phase 4 — deployment and hygiene

Fix private AI callbacks. Add a migration-specific secret/task/roles; promotion
requires its configuration and fails clearly rather than reusing runtime DDL rights.
Restrict migration-role pass/run templates, exclude sensitive build context files,
move pytest to dev requirements, format IAM JSON, update runbooks, and validate
all environment roots. Dedicated database roles/secret values are externally
provisioned, never hardcoded or read into Terraform state.

### Follow-up acceptance gates

MFA needs a reviewed enrollment/recovery and recent-auth policy. Financial return
metrics need agreed funding/withdrawal, fees, cost-basis, and rounding semantics.
Retained research needs consent/retention requirements. Large UI rewrites, runner
migration, job queues, read replicas, and 10,000-user capacity require measured
evidence and isolated staging. These are explicitly open work items, not fixes
declared complete by a successful unit test.

## Verification and rollout

Use isolated disposable PostgreSQL/Redis services, never existing application data.
Validate each phase before the next. Preserve existing v1 field names and accurate
error semantics; document intentional security/configuration tightening. Do not
deploy AWS or publish artifacts during this repository review. Record actual tests,
skips, and any limitations in the phase completion log below.

References: [Express proxy trust](https://expressjs.com/en/guide/behind-proxies/),
[Socket.IO origin handling](https://socket.io/docs/v4/handling-cors),
[OWASP session lifetimes](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Phase completion log

The plan was presented before implementation. The initial findings above remain
the baseline; this log records the current state rather than erasing findings.

### Phase 1: implemented

H01, H02, M02, M07 and L01: active-user session checks, required JWT claims and
UUIDs, socket origin checks and expiry disconnect, mobile WebSocket transport,
and safe JSON 400/413 responses. H03: configurable proxy trust preserves the
one-hop Compose default and sets two hops for ALB/Nginx in ECS. Network rules
must continue to prevent direct public access to API tasks.

### Phase 2: implemented

H04 and H05: closed positions retain realized gains; missing or incompatible
quotes produce explicit 503 valuation errors. A complete sell preserves 550.00
realized P/L in the disposable regression fixture. M06 is partially addressed:
failure behavior now agrees, but query consolidation and optional market-service
response contracts remain open. Decimal response fields and transaction locking
were preserved. M05 accounting/rounding semantics remain open.

### Phase 3: implemented with follow-ups

M01: serialized refresh/bootstrap, stale-response guards, reactive auth state,
private query cache cleanup, serialized login/logout and server logout errors.
Alerts reconnect with refreshed credentials after server expiry disconnect.
H09: new email links use fragments; verification/reset pages accept legacy links
and immediately remove tokens from the browser URL. Previously logged tokens
still require expiry/access-control handling; fragments cannot undo old logs.
M03: excess document work receives 429 before joining a queue. Upstream Node and
Python response reads enforce byte limits while streaming. PDF processing still
needs process isolation; cancelling a thread does not stop its work.

### Phase 4: implemented with operator prerequisites

H06: AI callbacks use private API discovery with a scoped AI-to-API TCP rule.
H07: a dedicated migration definition, secret, execution role and task role;
deployment rejects reused identities/secrets before running migrations. The
scanned API digest is used for the one-shot migration. IAM templates restrict
RunTask to the migration family and cluster. **Populate the new secret and GitHub
variable before promotion.** Distinct secret ARNs do not establish distinct SQL
users: provision/verify least-privilege runtime grants out of band.
M08/L02: exclude Terraform state/cache/plans and private load credentials from
Docker contexts; pytest now installs through requirements-dev.txt. IAM JSON
formatting and affected runbooks were corrected. Container privilege reduction,
audit expansion and optional dependency cleanup remain open.

### Validation evidence

- API: 37 tests passed, zero skips, including disposable PostgreSQL/Redis
  transaction, HTTP ownership, session status, socket expiry/origin and body
  error regressions. No existing application database was used.
- Web: 13 tests passed, including serialized refresh, one retry after 401 and
  stale-refresh/logout race. Production build passed. Final checks after later
  session serialization changes also pass; recovery URL cleanup runs in an effect
  so React StrictMode initialization stays free of side effects.
- Mobile: all 11 existing session, REST, trade-guard and chart tests passed.
- Python/release: 51 targeted tests passed, including RAG overload and separate
  migration identity rejection/success. One upstream AnyIO deprecation warning.
- Terraform composition: three mock plan tests passed. Environment validations
  passed for dev, staging and production; recursive formatting also passed.
- Final repository lint, formatting and workspace TypeScript checks passed.
  Docker/migration configuration tests: nine passed. No AWS apply or deployment
  was performed. Disposable database containers were removed after validation.

The web build emits a roughly 1,024 kB JavaScript chunk (311 kB gzip): **Medium
performance follow-up** for route splitting and measured rendering/loading
budgets. Build success does not establish acceptable mobile-network performance.

Still open: H08 MFA; M04 retained research; M05 accounting policy; remaining M06
contract duplication; M09 container hardening; M10 audit/outbox and SQL grants;
M11 measured scaling/backlog controls; M12 browser E2E and proposed runner
migration; L03 dependency candidates and L04 environment drift checks. Live AWS
IAM, TLS configuration, restore drills and 10,000-user capacity are unverified.
