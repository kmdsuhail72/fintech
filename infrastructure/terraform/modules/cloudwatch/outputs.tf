output "names" {
  value = { for name, group in aws_cloudwatch_log_group.this : name => group.name }
}
output "arns" {
  value = { for name, group in aws_cloudwatch_log_group.this : name => group.arn }
}
output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}
