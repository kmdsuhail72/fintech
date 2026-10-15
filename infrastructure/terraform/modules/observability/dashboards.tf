locals {
  application_panels = {
    requests          = { title = "API request count / minute", service = "api", names = ["RequestCount"], stat = "Sum" }
    errors            = { title = "API HTTP 4xx / 5xx / aborted", service = "api", names = ["HTTP4xx", "HTTP5xx", "AbortedRequests"], stat = "Sum" }
    latency           = { title = "API latency p95 (all routes, milliseconds)", service = "api", names = ["RequestLatency"], stat = "p95" }
    trades            = { title = "New committed paper trades / minute (best effort)", service = "api", names = ["TradesExecuted"], stat = "Sum" }
    sockets           = { title = "Maximum WebSocket connections on one API task", service = "api", names = ["WebSocketConnections"], stat = "Maximum" }
    socket_activity   = { title = "WebSocket opens / closes / auth failures", service = "api", names = ["WebSocketOpened", "WebSocketClosed", "WebSocketAuthFailures"], stat = "Sum" }
    pool              = { title = "Worst API task database pool counts", service = "api", names = ["DatabasePoolTotal", "DatabasePoolIdle", "DatabasePoolWaiting"], stat = "Maximum" }
    redis             = { title = "Redis health (0 unhealthy, 1 healthy)", service = "api", names = ["RedisHealthy"], stat = "Minimum" }
    ai_latency        = { title = "API to AI service latency p95 (milliseconds)", service = "api", names = ["AIServiceLatency"], stat = "p95" }
    ai_failures       = { title = "AI service call failures", service = "api", names = ["AIServiceFailures"], stat = "Sum" }
    provider_latency  = { title = "AI provider latency p95 (milliseconds)", service = "ai-service", names = ["AIProviderLatency"], stat = "p95" }
    provider_failures = { title = "AI provider failures", service = "ai-service", names = ["AIProviderFailures"], stat = "Sum" }
  }
  app_widgets = [for index, key in sort(keys(local.application_panels)) : {
    type = "metric", width = 12, height = 6, x = (index % 2) * 12, y = floor(index / 2) * 6,
    properties = {
      title = local.application_panels[key].title, region = var.region, period = 60,
      stat  = local.application_panels[key].stat,
      metrics = [for metric in local.application_panels[key].names : [local.namespace, metric,
      "Environment", var.environment, "Service", local.application_panels[key].service]],
    }
  }]
  infrastructure_widgets = [
    { type = "metric", x = 0, y = 36, width = 12, height = 6, properties = {
      title   = "ECS service CPU (%)", region = var.region, period = 60,
      metrics = [for service in values(var.services) : ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", service]]
    } },
    { type = "metric", x = 12, y = 36, width = 12, height = 6, properties = {
      title   = "ECS service memory (%)", region = var.region, period = 60,
      metrics = [for service in values(var.services) : ["AWS/ECS", "MemoryUtilization", "ClusterName", var.cluster_name, "ServiceName", service]]
    } },
    { type = "metric", x = 0, y = 42, width = 12, height = 6, properties = {
      title   = "RDS total database connections", region = var.region, period = 60, stat = "Maximum",
      metrics = [["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.database_id]]
    } },
    { type = "metric", x = 12, y = 42, width = 12, height = 6, properties = {
      title   = "Redis connections (all nodes)", region = var.region, period = 60,
      metrics = [for node in var.redis_cluster_ids : ["AWS/ElastiCache", "CurrConnections", "CacheClusterId", node, "CacheNodeId", "0001"]]
    } },
    { type = "metric", x = 0, y = 48, width = 12, height = 6, properties = {
      title = "ALB origin and load balancer errors / minute", region = var.region, period = 60, stat = "Sum",
      metrics = [for metric in ["HTTPCode_Target_4XX_Count", "HTTPCode_Target_5XX_Count", "HTTPCode_ELB_5XX_Count"] :
      ["AWS/ApplicationELB", metric, "LoadBalancer", var.alb_suffix]]
    } },
    { type = "log", x = 12, y = 48, width = 12, height = 6, properties = {
      title = "Recent application failures with trace IDs", region = var.region,
      query = "SOURCE '${var.log_groups["api"]}' | SOURCE '${var.log_groups["ai-service"]}' | fields @timestamp, service, message, traceId, requestId | filter level = 'error' | sort @timestamp desc | limit 30"
    } }
  ]
}
resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${var.name}-operations"
  dashboard_body = jsonencode({ start = "-PT6H", widgets = concat(local.app_widgets, local.infrastructure_widgets) })
}
resource "aws_cloudwatch_dashboard" "slos" {
  dashboard_name = "${var.name}-slos"
  dashboard_body = jsonencode({ start = "-P30D", widgets = [for index, name in sort(keys(local.slos)) : {
    type = "metric", width = 12, height = 6, x = (index % 2) * 12, y = floor(index / 2) * 6,
    properties = {
      title  = "${name}: rolling-window attainment, target ${100 * local.slos[name].goal}%",
      region = var.region, view = "singleValue", period = 86400, stat = "Sum", setPeriodToTimeRange = true,
      metrics = [
        [local.namespace, local.slos[name].bad, "Environment", var.environment, "Service", local.slos[name].service,
        "Operation", local.slos[name].operation, { id = "bad", visible = false }],
        [local.namespace, local.slos[name].total, "Environment", var.environment, "Service", local.slos[name].service,
        "Operation", local.slos[name].operation, { id = "total", visible = false }],
        [{ expression = "IF(total>0,100*(1-bad/total))", label = "Attainment (%)", id = "attainment" }],
        [{ expression = "IF(total>0,100*(1-(bad/total)/${1 - local.slos[name].goal}))", label = "Error budget remaining (%)", id = "budget" }]
      ]
    }
  }] })
}
