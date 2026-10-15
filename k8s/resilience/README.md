# Asteriq AI resilience game day

This is a test design and offline fault renderer, **not a record of successful
chaos tests**. No AWS account or cluster is needed to review it. Seven fault
profiles are renderable; node and Ingress failures use the manual procedures
below. No experiments are included in GitOps or application Kustomizations.

## Preconditions and steady state

Use an isolated staging cluster with synthetic accounts, paper orders, a stubbed
LLM and test-only Redis/PostgreSQL. Never send real orders or production email.
Select the explicit kubeconfig context on every kubectl command. Inventory the
context/account, nodes, namespace, dependency endpoints and affected tenants with
a second observer. Do not inject into a shared database, node or public hostname.
One experiment at a time; retain a separate unaffected administration path.

Install a pinned, reviewed Chaos Mesh release with matching CRDs and verify its
runtime/CNI/netem support. Its privileged node daemon belongs in a separately
controlled platform namespace; do not weaken Asteriq's restricted Pod Security,
non-root containers or Kyverno policies to install it. Scope experiment creation
RBAC to staging and use the controller's admission controls to restrict targets.
The renderer's fixed namespace is a convenience, not an admission boundary.
Validate generated CRs against the installed schema using server dry-run before
an actual create. Local tests check scope/structure, not Chaos Mesh compatibility.

Before each run, require 10 minutes of healthy traffic and stable replicas:

- All three Deployments fully available; no pending/unready pods, OOMs or rising
  restart counts. Staging currently has two replicas per service; use at least
  three API and two AI/frontend replicas for production-like recovery exercises.
  Raise HPA minima through a reviewed staging override, not a competing manual
  scale loop. Record and restore that override afterward.
- At least three schedulable workers across AZs, sufficient spare requested CPU
  and memory for one node's loss and HPA growth. Check actual placement; preferred
  pod anti-affinity alone does not guarantee different nodes. Zone spread can
  leave pods Pending if the remaining zones lack capacity.
- PDBs exist for frontend/API/AI with maxUnavailable=1 and matching selectors.
  Record currentHealthy, desiredHealthy, disruptionsAllowed and observedGeneration.
- Metrics Server and HPA metrics are fresh; ScalingActive=True and AbleToScale=True.
  Know the min/max bounds, CPU/memory request denominators and scale-down behavior.
- Prometheus, kube-state-metrics, cAdvisor and ALB/Ingress telemetry are working;
  Alertmanager test receivers and an observer are active. Record any approved
  maintenance routing; do not blanket-silence the alerts under test.
- Run the existing [k6 traffic profiles](../../tests/load/README.md), using a
  controlled steady rate that leaves headroom. Keep health probes, authenticated
  API reads, paper-order submissions with unique idempotency keys, and AI research
  probes running through the **public staging HTTPS route**, not only ClusterIP.
  Maintain separate direct-service probes to distinguish ingress from application
  failures. Do not save session tokens in evidence or Git.

Record baseline request counts, error ratio, p95, pod UIDs/node placement,
Deployment generation, HPA metrics/desired replicas, PDB status, EndpointSlices,
alerts and UTC timestamps in a copy of `results.example.yaml` under `.runtime/`.
An idle traffic generator or missing metric data makes the result inconclusive.

## Experiment matrix

Recovery times below are **initial acceptance targets**, measured from injection
for crashes/node loss and from fault removal for dependency/network faults.
They are not measured RTO guarantees. Establish baselines and adjust through review.

| Test | Injection and blast radius | Required evidence / acceptance target | Alert expectation |
| --- | --- | --- | --- |
| API pod crash | One API pod, force-delete once with PodChaos | Old UID disappears; new UID becomes Ready/Available within 120s; public traffic continues through remaining replicas; no duplicated/lost acknowledged paper orders | A quick replacement may produce no alert; pod deletion does not increment container restarts |
| AI pod crash | One AI pod, force-delete once | Replacement Ready within 300s, model warm-up validated by real research call; surviving AI handles traffic; cancelled work returns a bounded error | No AIUnavailable expected if a healthy replica remains; full AI outage is a separate test |
| Redis outage | Drop API egress to the exact test Redis host from all staging API pods for 180s | Readiness fails, API endpoints are withdrawn, liveness remains healthy; failures bounded by client deadlines; after cleanup Ready and successful session/order operations within 120s | RedisUnavailable after 2m only if probe continues emitting; API-target-down/5xx or SLO burn may fire depending route and traffic |
| Database connection failure | Drop API egress to the exact test RDS host for 180s | Same readiness/liveness separation; connections/pool return to baseline within 120s after cleanup; reconcile committed/failed/idempotent orders | Client errors or SLO burn; pg_up can stay 1 because exporter is unaffected; connection exhaustion is not implied |
| Node failure | One dedicated worker lost abruptly, separate from graceful drain | Node becomes NotReady, replacement pod UIDs run on healthy nodes; restore capacity and all desired replicas within initial 600s target; no unsafe duplicate writes | NodeUnavailable after 5m if NotReady remains observable; under-replicated alert requires 10m |
| High CPU | Stress API container on one pod; start 180s, optionally reviewed 900s | HPA increases desired replicas within 120s of sustained metric threshold; Ready capacity follows within 300s if nodes have room; compare public latency and throttling | PodCPUHigh needs >80% of limit continuously for 10m; short smoke need not fire |
| High memory | Allocate 256MB in one API container, then review measured headroom before increasing | Working set rises; HPA reacts if average request-relative usage crosses 80%; no leak after removal; for a separate approved OOM test, exit reason/restart recovery recorded | PodMemoryHigh requires >85% of limit for 10m; default 256MB injection does not guarantee this |
| Network latency | Add 600ms plus 50ms jitter from one API pod toward AI pods for 180s | AI calls show increased latency, propagated trace spans and bounded timeouts; unaffected routes remain usable; recovery within 60s after removal | Latency/burn alerts only if aggregate thresholds and hold durations are met |
| Ingress failure | Break one test-only Ingress host's backend mapping temporarily; optional dedicated-controller crash separately | Public probe fails while direct service probe succeeds; restore original backend, host/path, TLS and WebSocket access within 120s | ALB/Ingress 5xx with verified exporter plus external probe; application counters can remain healthy |

Dependency egress loss models **client reachability failure**, not a Redis process
crash or RDS failover. It affects every port at the chosen host/IP, and hostnames
may resolve to multiple/changing IPs. Verify affected IPs and that an existing
pooled TCP connection is actually interrupted; otherwise mark the run invalid.
Repeat against AI's RAG database path separately. Managed Redis/RDS process loss
and failover require a separate reviewed cloud fault experiment and account.

## Render, review, inject, clean up

The renderer writes YAML only and cannot apply, delete or contact a cluster:

```powershell
python scripts/kubernetes/resilience.py api-pod-crash --output .runtime/api-crash.yaml
python scripts/kubernetes/resilience.py high-cpu --duration 900 --output .runtime/cpu.yaml
python scripts/kubernetes/resilience.py redis-outage --endpoint REPLACE_TEST_REDIS_HOST --output .runtime/redis-loss.yaml
```

Other choices: `ai-pod-crash`, `database-connection-failure`, `high-memory`,
`network-latency`. Dependency names are metadata, never credential URLs.
Review the selected resource, namespace, endpoints and duration before proceeding.
Pod kill is one-shot; its duration is not a period of repeated kills.

For an authorized staging run, substitute the explicitly verified context:

```powershell
$resilienceContext = 'REPLACE_EXPLICIT_STAGING_CONTEXT'
kubectl --context $resilienceContext get nodes
kubectl --context $resilienceContext -n asteriq-staging get deploy,pods,hpa,pdb,endpointslices
kubectl --context $resilienceContext apply --dry-run=server -f .runtime/api-crash.yaml
kubectl --context $resilienceContext create -f .runtime/api-crash.yaml
# Observer records readiness, pod UIDs, traffic and alerts throughout.
kubectl --context $resilienceContext -n asteriq-staging delete podchaos asteriq-api-pod-crash --wait=true --timeout=120s
```

Use the actual kind/name for other profiles (NetworkChaos or StressChaos).
Duration expiration is only the primary timer. Keep a separate observer with a
wall-clock stop deadline who deletes the experiment if the controller fails.
Do not strip Chaos Mesh finalizers to force cleanup: confirm daemon recovery and
traffic restoration first. Deleting the CR does not resurrect killed pods; the
Deployment controller must replace them. Never rerun by creating overlapping CRs.

Abort immediately for wrong scope, unhealthy administration/monitoring, any
non-test traffic, acknowledged order mismatch, data corruption, more than one
node loss, unexplained node pressure, or no service recovery by the agreed RTO.
For single-pod tests, abort if a second replica becomes unavailable or public
failure ratio exceeds 1% for 60s. For the intentional dependency/Ingress outage,
the selected route may fail completely; abort if the fault escapes that route/
dependency boundary or lasts beyond its approved deadline. Do not prolong an
outage just to make a long-hold alert fire; use offline rule tests instead.

## Verify probes, replicas and PDBs

API readiness `/api/v1/ready` currently queries PostgreSQL and pings Redis. With
period=5s, failureThreshold=3 and timeout=3s, target withdrawal is approximately
15–30s plus EndpointSlice/ALB propagation, not instantaneous. Observe the actual
Pod Ready condition and EndpointSlice ready=false/removal; `publishNotReadyAddresses`
and ALB health propagation must not route normal traffic back to unready pods.
Liveness `/api/v1/health` must remain successful during dependency loss so it
does not cause a restart storm. Check client/readiness timeouts under packet
blackholes: repeated hanging checks must not exhaust DB/Redis connection pools.

**Current gap:** AI `/health/ready` and `/health/live` share a static OK handler.
It verifies HTTP-process responsiveness, not model warm-up, RAG DB or LLM
availability. Do not count a ready AI pod as proof of functional recovery: require
a real research smoke request. Define local-model readiness separately before
claiming a warm-up/readiness guarantee; external LLM failure should not automatically
restart every AI process. Keep this finding open until implemented and tested.

Readiness removal does not automatically create replacement pods. A Deployment
replaces deleted/lost pods, while kubelet restarts failed containers in the same
pod. Record UID/node/restartCount to distinguish these paths. One deletion need
not reschedule onto a different node; test cross-node scheduling with node loss.
Check availableReplicas against the **current** desired count because HPA may
change it; account for minReadySeconds and startupProbe's 300s allowance.

Test PDBs separately using the eviction API or a bounded graceful drain, never
infer PDB enforcement from force deletion. Healthy voluntary evictions should
proceed one at a time while maxUnavailable=1 is satisfied. For the negative case,
hold one API replica unready with a reviewed **one-pod** dependency fault, wait
for disruptionsAllowed=0, then attempt eviction of a different healthy API pod:
expect HTTP 429 until health recovers. Capture the response without retrying in
a tight loop. AlwaysAllow permits unhealthy-pod eviction; it must not allow a
second healthy disruption. Remove the fault before the next test.
PDBs do not prevent involuntary crashes or node-pressure eviction.
[Kubernetes disruption semantics](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)

## Node and Ingress manual procedures

First prove graceful maintenance on a dedicated, explicitly named staging worker:
inventory all its pods, cordon it, then use `kubectl --context CONTEXT drain NODE
--ignore-daemonsets --timeout=10m`. Do not use --disable-eviction, --force or
--delete-emptydir-data to bypass a blocker. Review each blocked workload or local
data dependency. Verify PDB enforcement, relocation and availability, then uncordon
the same node. Drain is not an abrupt node failure.

For an abrupt-loss exercise on EKS, use an approved AWS FIS/EC2 experiment scoped
to one tagged, dedicated worker instance, with a cloud-level stop condition and
recovery owner. There is no cloud mutation template in this demo. Keep healthy
nodes and capacity available; measure NotReady detection, default NoExecute
toleration delays, eviction and new pod readiness separately. Stopped EC2 nodes
can remain billed and require start/replacement cleanup. CA/Karpenter provisions
for Pending pods when configured; neither guarantees instant replacement or repairs
every failed node. Verify managed-node repair behavior explicitly. Never emulate
node failure by deleting a Node object and call that an infrastructure failure.

For Ingress routing failure, create/use a **staging-only hostname and isolated
Ingress**, save its backend mapping, then change that test host's service to a
nonexistent backend for at most 120s. Record AWS controller reconciliation/events
and the observed HTTP result (a 503 is not guaranteed if the controller retains
the old rule). If no actual public fault occurs, mark inconclusive. Restore only
the changed backend field under the same GitOps owner; do not overwrite unrelated
concurrent changes. Check trusted TLS, HTTPS redirect, host/path routing, CORS and
authenticated WebSocket reconnect after recovery. Keep production DNS/certificates
untouched. A separate ingress-controller pod crash tests reconciliation HA, not
necessarily data-plane failure: existing ALB listeners can continue serving traffic.

## Autoscaling, alerts and final recovery

Observe HPA currentMetrics/currentReplicas/desiredReplicas, scaling conditions and
events. CPU/memory HPA uses **requests**, while existing resource alerts compare
usage to **limits**; their thresholds are different. A single stressed replica
can be diluted by the average, and extra replicas do not remove an artificial
memory allocation from the original pod. Record no-scale as expected only when
the measured average stays below target, not as proof HPA works. Use sustained
application traffic across replicas for a separate scale-to-capacity exercise.
Verify scale-up with node headroom, then separately observe Pending pods trigger
CA/Karpenter, and verify scale-down after the configured stabilization window.
Do not accept maxReplicas saturation with continuing SLO failure as recovery.

Collect Prometheus pending/firing/resolved timestamps and actual receiver delivery
for relevant alerts. Include evaluation, scrape, `for` and Alertmanager group_wait
delays in the expected deadline. Default smoke faults last 3m, whereas CPU/memory
alerts need 10m and API latency needs 10m; do not expect those alerts to fire.
SLO burn alerts require both windows and sufficient bad fraction, not merely a
single error. A one-time pod deletion need not fire a restart or CrashLoop alert;
use a separate container-kill or repeated-start-failure exercise if testing those.
An AI scrape can be up while research fails, so pair it with functional probes.
Verify alert grouping/inhibition using a test receiver and offline rule cases
before commissioning human paging.

Remove every experiment, restore reviewed config, uncordon the selected node,
confirm Chaos Mesh no longer holds injections and check all desired replicas,
EndpointSlices and HPA conditions. Require 10 continuous minutes of healthy public
API/paper-trade/AI probes, no increasing restart counts or pool/socket leaks, and
resource metrics returning to baseline. Verify one committed result per paper
order/idempotency key. Track historical long-window burn alerts separately from
current recovery; they may remain after the fault ends. Complete the result file
with pass/fail/inconclusive evidence, cleanup and assigned findings. Restore any
temporary routing/scaling changes and review cost/quota changes.

Offline validation: `python -m pytest scripts/kubernetes/tests/test_resilience.py -q`.
References: [Chaos Mesh pod faults](https://chaos-mesh.org/docs/simulate-pod-chaos-on-kubernetes/),
[network faults](https://chaos-mesh.org/docs/simulate-network-chaos-on-kubernetes/) and
[stress faults](https://chaos-mesh.org/docs/simulate-heavy-stress-on-kubernetes/).
