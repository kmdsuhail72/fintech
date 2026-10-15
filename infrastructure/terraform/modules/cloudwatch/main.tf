resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(["web", "api", "ai-service", "vpc"])
  name              = "/asteriq/${var.name}/${each.key}"
  retention_in_days = var.retention_days
}
resource "aws_sns_topic" "alarms" {
  name              = "${var.name}-alarms"
  kms_master_key_id = aws_kms_key.alarms.arn
}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
resource "aws_kms_key" "alarms" {
  description         = "CloudWatch alarm notification encryption"
  enable_key_rotation = true
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    {
      Sid       = "AccountAdministration", Effect = "Allow",
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" },
      Action    = "kms:*", Resource = "*"
    },
    {
      Sid       = "CloudWatchAlarmDelivery", Effect = "Allow",
      Principal = { Service = "cloudwatch.amazonaws.com" },
      Action    = ["kms:Decrypt", "kms:GenerateDataKey*"], Resource = "*",
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id },
        ArnLike      = { "aws:SourceArn" = "arn:aws:cloudwatch:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:alarm:${var.name}-*" }
      }
    }
  ] })
}
resource "aws_sns_topic_policy" "alarms" {
  arn = aws_sns_topic.alarms.arn
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    {
      Sid       = "AccountAdministration", Effect = "Allow",
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" },
      Action    = "sns:*", Resource = aws_sns_topic.alarms.arn
    },
    {
      Sid       = "CloudWatchAlarmDelivery", Effect = "Allow",
      Principal = { Service = "cloudwatch.amazonaws.com" },
      Action    = "sns:Publish", Resource = aws_sns_topic.alarms.arn,
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id },
        ArnLike      = { "aws:SourceArn" = "arn:aws:cloudwatch:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:alarm:${var.name}-*" }
      }
    }
  ] })
}
