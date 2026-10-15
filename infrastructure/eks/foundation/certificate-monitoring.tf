resource "aws_cloudwatch_metric_alarm" "certificate_expiry" {
  alarm_name          = "${local.name}-acm-expiring"
  alarm_description   = "ACM certificate expires within 30 days; verify DNS validation and managed renewal."
  namespace           = "AWS/CertificateManager"
  metric_name         = "DaysToExpiry"
  statistic           = "Minimum"
  period              = 43200
  evaluation_periods  = 1
  comparison_operator = "LessThanOrEqualToThreshold"
  threshold           = 30
  treat_missing_data  = "missing"
  dimensions          = { CertificateArn = aws_acm_certificate.origin.arn }
  alarm_actions       = [module.cloudwatch.alarm_topic_arn]
  ok_actions          = [module.cloudwatch.alarm_topic_arn]
}
