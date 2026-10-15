# Asteriq AI: 10,000-user load-test design

The supplied k6 scenario simulates **10,000 concurrent logical users**, not
10,000 requests/second. Each VU retains its own synthetic identity and can make
asynchronous HTTP requests while receiving Socket.IO market updates. Defaults
select a ten-user smoke test; the 10,000-user profile must be explicitly selected.
No load test has been executed and no measured bottleneck or capacity claim is made.

Scripts: [mixed.js](../tests/load/mixed.js), [socketio.js](../tests/load/socketio.js),
and [dataset schema example](../tests/load/users.example.json).
Telemetry: [CloudWatch observability stack](./observability.md).

## Workload model at full capacity

| Behavior                | Users       | Cadence                                               | Offered load during steady state               |
| ----------------------- | ----------- | ----------------------------------------------------- | ---------------------------------------------- |
| Portfolio reads         | 10,000      | Every 60 seconds                                      | About 166.7 requests/sec                       |
| HTTP quote reads        | 1,000 (10%) | Every 10 seconds                                      | About 100 requests/sec                         |
| Market streams          | 6,000 (60%) | Persistent authenticated socket; one symbol initially | About 6,000 simultaneous Socket.IO connections |
| Paper buy/sell requests | 2,000 (20%) | One order every 120 seconds                           | About 16.7 requests/sec                        |
| AI research             | 100 (1%)    | Every 300 seconds                                     | About 0.33 requests/sec                        |

Cohorts overlap; they are not additional users. Approximate steady HTTP demand
is **283.7 requests/sec**, plus token refresh and other protocol traffic. This is
a proposed usage model, not a business forecast. Cadences use deterministic
jitter; measure achieved load rather than assuming the model was delivered.
Each trade user alternates BUY/SELL only after a confirmed fill, uses small paper
quantities, and retains its idempotency key after an ambiguous failure.

Increase AI participation separately after the baseline. At 10% participation,
one research request/5 minutes offers 3.33 AI requests/sec, which can far exceed
the current synchronous admission/provider capacity.

Cadences persist across VU iterations, including the five-minute AI schedule.
The helper implements Engine.IO v4 open/ping/pong and Socket.IO default-namespace
connect/event packets. It sends auth in `40{...}` and subscriptions in `42[...]`;
it does not treat Socket.IO as a raw WebSocket JSON API or put tokens in URLs.
It is intentionally limited to the current text/default-namespace protocol.
Re-test it if changing Socket.IO version, namespaces, compression, or binary events.
[Socket.IO protocol overview](https://socket.io/docs/v4/),
[k6 event-loop WebSockets](https://grafana.com/docs/k6/latest/javascript-api/k6-websockets/).

## Profiles and execution

| Profile                        | Shape                                                  | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------- |
| Smoke                          | 10 users, 5-minute hold                                | Validate sessions, protocol, stubs, metrics, and assertions   |
| Baseline                       | Ramp to 1,000; 10-minute hold                          | Establish resource/latency baseline                           |
| Capacity                       | 50 → 500 → 2,000 → 5,000 → 10,000; 20-minute peak hold | Locate the first capacity constraint                          |
| Spike, separate controlled run | 2,000 → 10,000 in 1–2 minutes                          | Test connection acceptance and autoscaling delay              |
| Soak, separate controlled run  | Sustainable peak for 1–4 hours                         | Detect memory/pool/Redis-key leaks and session refresh issues |

The supplied capacity profile takes about 50 minutes plus graceful cleanup. VU
iterations last four minutes, with HTTP schedules and sockets active together.
Each scheduled operation has a per-VU overlap guard. Skipped schedules fail a
threshold so throughput reduction is not hidden. This remains a closed user
model; add separate constant-arrival-rate endpoint tests for fixed-RPS capacity
and coordinated-omission analysis.

Use a recent k6 release supporting `k6/websockets` and `http.asyncRequest`. k6 is
not installed in this workspace, so runtime execution remains a rollout check.
The guard variables are operator acknowledgements, not proof that the target is safe.

```sh
# Supply through your shell or CI environment, not source control:
BASE_URL=https://staging.example.com
APPROVED_TARGET_HOST=staging.example.com
USERS_FILE=/private/path/users.json
AI_STUB_CONFIRMED=true
RUN_ID=unique-short-run-id
PROFILE=smoke

# Create test-results first. Configure these variables as exported env values.
k6 run tests/load/mixed.js
```

For PowerShell use `$env:NAME='value'`. After smoke and baseline pass, explicitly
set PROFILE=capacity. RUN_ID must be short, unique per run, and limited to letters,
digits, dot, underscore, or hyphen so order keys satisfy API validation.
Summary output is `test-results/load-summary.json`; do not commit private session
datasets. No real-money account or production customer data belongs in a load test.

## Test data and prerequisites

Provision a disposable staging environment matching production topology, capacity,
TLS/proxy routing, database indexes, and Multi-AZ behavior. Provide one verified
synthetic user, distinct portfolio/wallet, active session, and current access/refresh
token per VU. Dataset entries require userId, portfolioId, symbolId, accessToken,
refreshToken, and numeric expiresAtMs. The example contains placeholders, not a
runnable or credential-bearing fixture. The script refuses duplicate user IDs.

Seed ample paper cash, active AAPL symbols, and continuously fresh SIMULATED
quotes. Share symbols across users, not accounts/wallets. The main profile uses
one subscribed symbol/user; later sweep 5/20/50 symbols/user and realistic holding
counts to expose fanout and portfolio-query scaling. Record random seed/data size.

JWTs expire after ten minutes. Each VU serializes refresh, stores the rotated
token, and reconnects its socket on token changes. Do not share one refresh token
between users/generators: concurrent reuse revokes the session. Dataset/session
provisioning is required setup; a seeder is not implemented by these scripts.
Generate fresh sessions for every run: rotated tokens are held in VU memory and
are not written back to the dataset. Reusing the original file can trigger replay
revocation. Never enable HTTP debug output containing authorization/body secrets.

**Rate limiting is a prerequisite, not a capacity result.** Current proxy trust
misattributes users to ALB IPs, as documented in the security review. Fix and test
the trusted proxy chain first. HTTP limits are 300/minute per IP, refresh limits
30/minute per IP, and login limits 10/15 minutes per IP. A handful of generators
sharing source IPs can otherwise measure rejection capacity rather than application
capacity. Use representative source-IP distribution or an explicitly documented
isolated test configuration. Retain a separate production-policy abuse/rate-limit
test. Do not silently classify normal-load 429s as successful traffic.

A deterministic AI provider stub is also required. The current research adapter
uses a fixed external provider URL; an injectable staging provider/transport must
be configured before setting AI_STUB_CONFIRMED. Merely setting the variable does
not install the stub. Use realistic latency, response sizes, and failure profiles,
not an instant empty success. Real-provider canaries require separate budgets.
Also resolve the documented AI→API callback URL/security-group deployment gap.

Before each run verify token readiness, CORS origins, raw/proxied Socket.IO auth,
quote publication, a buy/sell round trip, portfolio reconciliation, AI report
contracts, and CloudWatch/SNS telemetry. Keep clocks synchronized for quote-lag
measurements. Back up any retained synthetic dataset before destructive cleanup.

## Load-generator sizing

Use distributed generators or a managed k6 service for the 10,000-user run. Start
with a small generator benchmark, then partition execution with k6 segments and
global idInTest identity mapping. Merely running the entire scenario on several
machines multiplies load and can reuse/revoke the same sessions.

Monitor generator CPU, memory, file descriptors, ports, bandwidth, and timer lag.
Keep generator headroom, synchronize start times, and use a metrics backend or
central result processor to merge raw histograms/samples. **Never average p95/p99
values from separate generators.** Large VU counts and market messages can make
the generator the first bottleneck. Validate actual user/connection/RPS plateaus.

Do not infer fleet active sockets from a per-VU Gauge. The script records aggregate
`socketio_opened` and `socketio_closed` counters after authenticated connect; derive
active sockets from their cumulative time-series difference. Both counters return
to equal totals after normal cleanup, so the final summary alone cannot prove
peak concurrency. Capture time series during the hold period. Cross-check API
per-task gauges, ECS task distribution, and ALB connection metrics.

## Measures and starting acceptance goals

These thresholds are initial test gates, not measured service guarantees:

| Operation/signal               | p95       | p99       | Additional gate                                          |
| ------------------------------ | --------- | --------- | -------------------------------------------------------- |
| Portfolio reads                | <500 ms   | <1,000 ms | Valid envelope and owner data                            |
| Quote reads                    | <300 ms   | <750 ms   | Fresh seeded quote                                       |
| Trade requests                 | <1,000 ms | <2,000 ms | Reconcile exactly-once financial effects                 |
| AI research                    | <10 sec   | <20 sec   | Valid report; stub latency recorded                      |
| Server quote → client delivery | <1,000 ms | <2,000 ms | No stale streams/negative-clock-skew samples             |
| Overall application errors     | —         | —         | Below 1%; all unexpected 4xx/5xx/invalid envelopes count |

Error gates apply per operation as well as overall, so low-volume AI failures
cannot disappear beneath a large volume of successful reads.
Track `app_requests` count/rate and native `http_reqs`; app_latency is tagged by
operation. The error metric includes invalid successful envelopes, not only HTTP
5xx. Separate reconnect/refresh overhead from business traffic. Protocol and
scenario errors have their own counters; startup must be verified in smoke.

Record alongside k6:

- ECS/API/web/AI CPU, memory, running tasks, scaling timestamps and deployment events.
- RDS CPU, connections, memory, ReadLatency/WriteLatency, IOPS, storage throughput.
- API pool waiters; PostgreSQL query/lock statistics, top statements and transaction
  time using CloudWatch Database Insights and approved database diagnostics.
- Redis engine CPU, memory/eviction, connections, replication lag, probe latency.
- Socket opens/closes, delivery lag, messages/sec, reconnects, busiest task.
- AI admitted/rejected work, actual provider elapsed time, rate limits and queue behavior.

Use the observability dashboards and a unique run time range. Some required deep
DB/collector/generator diagnostics are additional setup; the existing dashboards
do not expose every query plan, generator metric, or true fleet socket gauge.

Post-run query the authoritative ledger: no negative balances/holdings, one trade
per idempotency key, positions matching fills, cash matching funding plus ledger,
and no cross-user changes. HTTP 201 counts and best-effort CloudWatch trade counters
do not by themselves prove financial integrity.

## Bottleneck hypotheses and scaling decisions

These are source-based hypotheses to test, not benchmark findings:

| Likely constraint                  | Why it matters at this load                                                            | Confirm with                                                | Scaling/remediation                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Proxy/IP rate-limit buckets        | Shared ALB/generator IPs can reject normal traffic first                               | 429 rate, resolved-IP diagnostic, quota distribution        | Fix trusted proxy chain; representative IPs; test-only policy recorded separately                                      |
| Socket session checks              | 6,000 sockets check sessions every 15 sec: ~400 DB reads/sec before HTTP               | Pool waiters, DB CPU, session query rate/latency            | Revocation-aware session cache with bounded TTL; preserve active-status checks and fail policy                         |
| Nginx/API connection capacity      | Every proxied stream holds client/upstream connections                                 | FD/worker limits, ALB errors, CPU, per-task connections     | Tune worker/FD limits after measuring; scale web/API independently; consider direct API ALB target to remove proxy hop |
| Market fanout and Redis heartbeats | One symbol/6,000 sockets gives ~400 zAdd heartbeats/sec; five symbols gives ~2,000     | Redis CPU/commands, quote delivery lag, Node event-loop lag | Batched/coalesced heartbeats; efficient fanout; symbol partitioning; dedicated stream gateway if justified             |
| Portfolio query cost               | ~167 reads/sec with joins/valuation grows with positions/user                          | Top statements, buffer hits, explain plans, p99/pool waits  | Preserve indexes; optimize queries; short-lived owner-scoped projections; read replicas for stale-tolerant reads       |
| DB connection amplification        | More API/AI tasks multiply pools and short-lived AI connections                        | DB connections vs task count; pool waiters; memory          | Bound pools against connection budget; evaluate RDS Proxy/pgBouncer; do not blindly raise max_connections              |
| Trade locking/commit latency       | Transactions lock account/wallet and perform multiple writes; Multi-AZ affects commits | Lock waits, transaction duration, commit/IO latency         | Keep transactions short; independent accounts in baseline; deliberate hot-wallet tests; preserve locks/idempotency     |
| AI admission/provider capacity     | Two admitted generations/process; HTTP CPU may stay low while waiting on vendor        | Busy 503s, in-flight work, vendor latency/quota             | Scale by admission/in-flight/queue metrics, not CPU alone; bounded jobs/202 workflow if needed; per-user budgets       |
| Generator capacity                 | Thousands of timers/TLS sockets/messages stress generators                             | Generator CPU/memory/timer drift, actual achieved RPS       | Distributed execution; tune OS limits; merge raw measurements correctly                                                |

AI sizing uses Little's Law: required concurrency ≈ arrival rate × **mean** service
time, then add headroom. At 0.33 requests/sec and 10-second mean service time,
about 3.3 slots are occupied; at 45 seconds, about 15 slots are occupied. With two
slots/process, that implies roughly two vs eight processes before headroom.
Measure the mean; do not substitute p95 as if it were the mean. Existing Terraform
CPU scaling and max task counts may need adjustment, and provider quotas still apply.

Never fix trading contention by dropping transaction locks, skipping ownership,
using floating-point money, or disabling audit/ledger constraints. Read replicas
must not serve correctness-sensitive post-trade decisions with stale data.

## Reporting and iteration

For each plateau report actual users, authenticated active streams, offered and
achieved RPS, per-operation p95/p99/error rate, generator utilization, ECS/RDS/Redis
utilization, scaling lag, and reconciliation results. Include timestamps, task/DB
sizes, image digests, fixture size, stub latency, rate-limit policy, and run duration.

Stop at the first unexplained failure plateau; collect evidence, change one capacity
or code factor, and repeat the same profile. Report sustainable capacity only when
latency, errors, financial integrity, and generator headroom pass together. No
bottleneck or 10,000-user support claim is confirmed until this evidence exists.
