resource "aws_cloudwatch_metric_alarm" "ecs_memory" {
  for_each            = module.ecs.service_names
  alarm_name          = "${local.name}-${each.key}-memory"
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  dimensions          = { ClusterName = module.ecs.cluster_name, ServiceName = each.value }
  alarm_actions       = [module.cloudwatch.alarm_topic_arn]
}
