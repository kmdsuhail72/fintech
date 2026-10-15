resource "aws_wafv2_web_acl" "this" {
  name  = local.name
  scope = "REGIONAL"
  default_action {
    allow {}
  }
  rule {
    name     = "AWSCommonRules"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "RateLimit"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate"
      sampled_requests_enabled   = false
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = false
  }
}
resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = module.alb.arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}
