resource "aws_wafv2_web_acl" "edge" {
  provider = aws.edge
  name     = "${local.name}-edge"
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }
  dynamic "rule" {
    for_each = { AWSManagedRulesCommonRuleSet = 10, AWSManagedRulesKnownBadInputsRuleSet = 20, AWSManagedRulesAmazonIpReputationList = 30 }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        sampled_requests_enabled   = false
        metric_name                = rule.key
      }
    }
  }
  rule {
    name     = "PerIPRateLimit"
    priority = 40
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = false
      metric_name                = "PerIPRateLimit"
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    sampled_requests_enabled   = false
    metric_name                = "${local.name}-edge"
  }
}
resource "aws_wafv2_web_acl" "origin" {
  name  = "${local.name}-origin"
  scope = "REGIONAL"
  default_action {
    block {}
  }
  rule {
    name     = "OnlyThisCloudFrontDistribution"
    priority = 1
    action {
      allow {}
    }
    statement {
      byte_match_statement {
        search_string         = var.origin_verification_header
        positional_constraint = "EXACTLY"
        field_to_match {
          single_header { name = "x-asteriq-origin" }
        }
        text_transformation {
          priority = 0
          type     = "NONE"
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = false
      metric_name                = "OnlyThisDistribution"
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    sampled_requests_enabled   = false
    metric_name                = "${local.name}-origin"
  }
}
resource "aws_wafv2_web_acl_association" "origin" {
  resource_arn = data.aws_lb.origin.arn
  web_acl_arn  = aws_wafv2_web_acl.origin.arn
}
# Block logs only; omit URI/query/cookies/authentication and the origin secret.
resource "aws_cloudwatch_log_group" "waf" {
  provider          = aws.edge
  name              = "aws-waf-logs-${local.name}-edge"
  retention_in_days = 90
}
resource "aws_wafv2_web_acl_logging_configuration" "edge" {
  provider                = aws.edge
  resource_arn            = aws_wafv2_web_acl.edge.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  redacted_fields {
    query_string {}
  }
  redacted_fields {
    uri_path {}
  }
  redacted_fields {
    single_header { name = "authorization" }
  }
  redacted_fields {
    single_header { name = "cookie" }
  }
  redacted_fields {
    single_header { name = "x-asteriq-origin" }
  }
  logging_filter {
    default_behavior = "DROP"
    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"
      condition {
        action_condition { action = "BLOCK" }
      }
    }
  }
}
