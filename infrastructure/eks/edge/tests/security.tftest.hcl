mock_provider "aws" {
  mock_data "aws_lb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:ap-south-1:123456789012:loadbalancer/app/asteriq-test/0123456789abcdef"
      dns_name = "asteriq-test.ap-south-1.elb.amazonaws.com"
      zone_id  = "Z0123456789"
    }
  }
}
run "dual_domain_viewer_https" {
  command = plan
  variables {
    certificate_validation_record_fqdn             = "_synthetic.app.asteriq.ai."
    domain_name                                    = "app.asteriq.ai"
    additional_domain_names                        = ["api.asteriq.ai"]
    additional_certificate_validation_record_fqdns = ["_synthetic.api.asteriq.ai."]
  }
  assert {
    condition     = contains(aws_cloudfront_distribution.this.aliases, "app.asteriq.ai") && contains(aws_cloudfront_distribution.this.aliases, "api.asteriq.ai") && contains(aws_acm_certificate.viewer.subject_alternative_names, "api.asteriq.ai")
    error_message = "CloudFront must accept both domains using a matching viewer certificate."
  }
  assert {
    condition     = length(aws_route53_record.viewer) == 2 && length(aws_route53_record.additional_viewer) == 2
    error_message = "Create IPv4 and IPv6 DNS aliases for both public names."
  }
  assert {
    condition     = contains(aws_cloudfront_cache_policy.assets.parameters_in_cache_key_and_forwarded_to_origin[0].headers_config[0].headers[0].items, "Host") && aws_cloudfront_cache_policy.assets.parameters_in_cache_key_and_forwarded_to_origin[0].cookies_config[0].cookie_behavior == "none"
    error_message = "Public assets must forward viewer Host without session cookies."
  }
}
mock_provider "aws" { alias = "edge" }
variables {
  account_id                         = "123456789012"
  region                             = "ap-south-1"
  environment                        = "production"
  zone_id                            = "Z0123456789"
  domain_name                        = "asteriq.test.example.org"
  origin_alb_name                    = "asteriq-production-eks-web"
  certificate_validation_record_fqdn = "_synthetic.asteriq.test.example.org."
  origin_verification_header         = "syntheticTestOnlyNeverARealSecret12345"
}
run "protected_uncached_dynamic_edge" {
  command = plan
  assert {
    condition     = aws_cloudfront_distribution.this.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https" && one(aws_cloudfront_distribution.this.origin).custom_origin_config[0].origin_protocol_policy == "https-only"
    error_message = "Encrypt both viewer and origin transport."
  }
  assert {
    condition     = aws_cloudfront_distribution.this.default_cache_behavior[0].cache_policy_id == data.aws_cloudfront_cache_policy.disabled.id
    error_message = "Never cache authenticated API and WebSocket traffic."
  }
  assert {
    condition     = length(aws_wafv2_web_acl.origin.default_action[0].block) == 1 && aws_wafv2_web_acl.edge.scope == "CLOUDFRONT"
    error_message = "Protect the viewer and fail closed at the ALB origin."
  }
}
