# Request-based component SLOs implemented with EMF counters and metric math.
# These are not Application Signals managed SLO resources or external canaries.
locals {
  slos = {
    api-availability = { service = "api", operation = "core", goal = 0.999, bad = "SloErrors", total = "SloRequests" }
    api-latency      = { service = "api", operation = "core", goal = 0.99, bad = "SlowRequests", total = "SuccessfulRequests" }
    ai-availability  = { service = "ai-service", operation = "research", goal = 0.99, bad = "SloErrors", total = "SloRequests" }
    ai-latency       = { service = "ai-service", operation = "research", goal = 0.95, bad = "SlowRequests", total = "SuccessfulRequests" }
  }
  burn_windows = {
    fast-short = { period = 300, threshold = 14.4 }
    fast-long  = { period = 3600, threshold = 14.4 }
    slow-short = { period = 1800, threshold = 6 }
    slow-long  = { period = 21600, threshold = 6 }
  }
  burn_alarms = { for item in setproduct(keys(local.slos), keys(local.burn_windows)) :
  "${item[0]}-${item[1]}" => { slo = local.slos[item[0]], window = local.burn_windows[item[1]] } }
  composites = { for item in setproduct(keys(local.slos), ["fast", "slow"]) :
  "${item[0]}-${item[1]}" => { slo = item[0], speed = item[1] } }
}
resource "aws_cloudwatch_metric_alarm" "burn" {
  for_each            = local.burn_alarms
  alarm_name          = "${var.name}-slo-${each.key}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = each.value.window.threshold
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_description   = "Component request error-budget burn; paired with another window. No traffic is unknown, not success."
  metric_query {
    id          = "burn"
    expression  = "IF(total>=20,(bad/total)/${1 - each.value.slo.goal})"
    return_data = true
  }
  dynamic "metric_query" {
    for_each = { bad = each.value.slo.bad, total = each.value.slo.total }
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = local.namespace
        metric_name = metric_query.value
        period      = each.value.window.period
        stat        = "Sum"
        dimensions  = { Environment = var.environment, Service = each.value.slo.service, Operation = each.value.slo.operation }
      }
    }
  }
}
resource "aws_cloudwatch_composite_alarm" "burn" {
  for_each          = local.composites
  alarm_name        = "${var.name}-slo-${each.key}-page"
  alarm_rule        = "ALARM(\"${aws_cloudwatch_metric_alarm.burn["${each.value.slo}-${each.value.speed}-short"].alarm_name}\") AND ALARM(\"${aws_cloudwatch_metric_alarm.burn["${each.value.slo}-${each.value.speed}-long"].alarm_name}\")"
  alarm_actions     = [var.alarm_topic_arn]
  ok_actions        = [var.alarm_topic_arn]
  alarm_description = "${each.value.speed} multi-window SLO burn; investigate request and infrastructure dashboards."
}
