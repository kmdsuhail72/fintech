# Grafana LogQL queries

Use the provisioned **Loki** datasource in Grafana Explore. Alloy writes tenant
`asteriq`; Grafana's datasource already sets that tenant header. Change the
namespace regex or add `environment="production"` to scope an investigation.
These queries use normalized JSON fields; correlation identifiers are not
indexed stream labels.

## Errors

```logql
{namespace=~"asteriq-(dev|staging|production)|kube-system|ingress-nginx|ingress-system|cert-manager|monitoring",level=~"error|fatal|panic"} | json | __error__=""
```

## HTTP 500

```logql
{namespace=~"asteriq-(dev|staging|production)"} | json | status_code="500" | __error__=""
```

## Authentication failures

```logql
{namespace=~"asteriq-(dev|staging|production)",service=~"api|ai-service"} | json | event="authentication_failure" | __error__=""
```

Unauthorized and forbidden responses together:

```logql
{namespace=~"asteriq-(dev|staging|production)",service=~"api|ai-service"} | json | status_code=~"401|403" | __error__=""
```

## AI service failures

```logql
{namespace=~"asteriq-(dev|staging|production)",service="ai-service"} | json | event=~"ai_failure|database_failure" | __error__=""
```

API-to-AI HTTP failures:

```logql
{namespace=~"asteriq-(dev|staging|production)",service="api"} | json | event="ai_failure" | __error__=""
```

## Trade failures

```logql
{namespace=~"asteriq-(dev|staging|production)",service="api"} | json | event="trade_failure" | __error__=""
```

Include authentication/authorization failures on order endpoints:

```logql
{namespace=~"asteriq-(dev|staging|production)",service="api"} | json | endpoint=~".*orders.*" | status_code >= 400 | __error__=""
```

## Database failures

```logql
{namespace=~"asteriq-(dev|staging|production)",service=~"api|ai-service"} | json | event="database_failure" | __error__=""
```

## Correlate a trace

```logql
{namespace="asteriq-production"} | json | trace_id="REPLACE_TRACE_ID" | __error__=""
```

## Error rate for a Grafana time series

```logql
sum by (service) (rate({namespace="asteriq-production",level=~"error|fatal|panic"} | json | __error__="" [5m]))
```

Native system logs without a supported severity prefix are normalized with
`level="unknown"`. Inspect those separately instead of treating every stderr
line as an error. Set real controller log levels and JSON output where supported.
The HTTP completion event records rejected trades as operational failures,
including validation/auth errors; it does not imply a financial transaction was
executed. An HTTP 500 is not necessarily a logged `level="error"`, so use status
queries independently of severity.
