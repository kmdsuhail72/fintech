locals {
  namespace              = "Asteriq/Application"
  application_dimensions = { Environment = var.environment, Service = "api" }
  native_alarms = merge(
    { for service, name in var.services : "${service}-cpu" => {
      namespace  = "AWS/ECS", metric = "CPUUtilization", stat = "Average", threshold = 80,
      comparison = "GreaterThanThreshold", dimensions = { ClusterName = var.cluster_name, ServiceName = name }
    } },
    { for service, name in var.services : "${service}-tasks" => {
      namespace  = "ECS/ContainerInsights", metric = "RunningTaskCount", stat = "Minimum", threshold = var.minimum_task_count,
      comparison = "LessThanThreshold", dimensions = { ClusterName = var.cluster_name, ServiceName = name }
    } },
    {
      database-connections = { namespace = "AWS/RDS", metric = "DatabaseConnections", stat = "Maximum",
        threshold = var.database_connection_threshold, comparison = "GreaterThanThreshold",
      dimensions = { DBInstanceIdentifier = var.database_id } }
      database-cpu = { namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average",
      threshold = 80, comparison = "GreaterThanThreshold", dimensions = { DBInstanceIdentifier = var.database_id } }
      database-memory = { namespace = "AWS/RDS", metric = "FreeableMemory", stat = "Minimum",
      threshold = 268435456, comparison = "LessThanThreshold", dimensions = { DBInstanceIdentifier = var.database_id } }
      alb-errors = { namespace = "AWS/ApplicationELB", metric = "HTTPCode_ELB_5XX_Count", stat = "Sum",
      threshold = 0, comparison = "GreaterThanThreshold", dimensions = { LoadBalancer = var.alb_suffix } }
    },
    { for node in var.redis_cluster_ids : "${node}-cpu" => {
      namespace  = "AWS/ElastiCache", metric = "EngineCPUUtilization", stat = "Average", threshold = 75,
      comparison = "GreaterThanThreshold", dimensions = { CacheClusterId = node, CacheNodeId = "0001" }
    } },
    { for node in var.redis_cluster_ids : "${node}-memory" => {
      namespace  = "AWS/ElastiCache", metric = "DatabaseMemoryUsagePercentage", stat = "Maximum", threshold = 80,
      comparison = "GreaterThanThreshold", dimensions = { CacheClusterId = node, CacheNodeId = "0001" }
    } }
  )
  custom_alarms = {
    redis-unhealthy         = { metric = "RedisHealthy", stat = "Minimum", threshold = 1, comparison = "LessThanThreshold", missing = "notBreaching" }
    api-telemetry-missing   = { metric = "RuntimeHeartbeat", stat = "Sum", threshold = 1, comparison = "LessThanThreshold", missing = "breaching" }
    database-pool-waiting   = { metric = "DatabasePoolWaiting", stat = "Maximum", threshold = 0, comparison = "GreaterThanThreshold", missing = "notBreaching" }
    websocket-auth-failures = { metric = "WebSocketAuthFailures", stat = "Sum", threshold = 20, comparison = "GreaterThanThreshold", missing = "notBreaching" }
  }
}
resource "aws_cloudwatch_metric_alarm" "native" {
  for_each            = local.native_alarms
  alarm_name          = "${var.name}-${each.key}"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dimensions
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = endswith(each.key, "-tasks") ? "breaching" : "notBreaching"
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]
}
resource "aws_cloudwatch_metric_alarm" "custom" {
  for_each            = local.custom_alarms
  alarm_name          = "${var.name}-${each.key}"
  namespace           = local.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = local.application_dimensions
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = each.value.missing
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]
}
resource "aws_cloudwatch_metric_alarm" "ai_dependency" {
  alarm_name          = "${var.name}-ai-dependency-failures"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarm_topic_arn]
  metric_query {
    id          = "rate"
    expression  = "IF(requests>=5,100*failures/requests)"
    return_data = true
  }
  dynamic "metric_query" {
    for_each = { requests = "AIServiceRequests", failures = "AIServiceFailures" }
    content {
      id          = metric_query.key
      return_data = false
      metric {
        metric_name = metric_query.value
        namespace   = local.namespace
        period      = 60
        stat        = "Sum"
        dimensions  = local.application_dimensions
      }
    }
  }
}
