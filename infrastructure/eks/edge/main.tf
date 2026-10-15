locals {
  name          = "asteriq-${var.environment}-eks"
  origin_domain = "origin.${var.domain_name}"
}
data "aws_lb" "origin" { name = var.origin_alb_name }
resource "aws_route53_record" "origin" {
  zone_id = var.zone_id
  name    = local.origin_domain
  type    = "A"
  alias {
    name                   = data.aws_lb.origin.dns_name
    zone_id                = data.aws_lb.origin.zone_id
    evaluate_target_health = true
  }
}
resource "aws_acm_certificate" "viewer" {
  provider                  = aws.edge
  domain_name               = var.domain_name
  subject_alternative_names = var.additional_domain_names
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}
# Foundation owns the same-account/domain DNS token shared across regions.
resource "aws_acm_certificate_validation" "viewer" {
  provider                = aws.edge
  certificate_arn         = aws_acm_certificate.viewer.arn
  validation_record_fqdns = concat([var.certificate_validation_record_fqdn], var.additional_certificate_validation_record_fqdns)
  lifecycle {
    precondition {
      condition     = length(var.additional_domain_names) == length(var.additional_certificate_validation_record_fqdns)
      error_message = "Provide a foundation-owned DNS validation FQDN for every additional viewer domain."
    }
  }
}
data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
resource "aws_cloudfront_cache_policy" "assets" {
  name        = "${local.name}-public-assets-by-host"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
    headers_config {
      header_behavior = "whitelist"
      headers { items = ["Host"] }
    }
    cookies_config { cookie_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
data "aws_cloudfront_origin_request_policy" "viewer" { name = "Managed-AllViewer" }
resource "aws_cloudfront_distribution" "this" {
  depends_on      = [aws_wafv2_web_acl_association.origin]
  enabled         = true
  is_ipv6_enabled = true
  aliases         = distinct(concat([var.domain_name], var.additional_domain_names))
  comment         = "Asteriq EKS: uncached dynamic requests, cached versioned assets"
  web_acl_id      = aws_wafv2_web_acl.edge.arn
  origin {
    domain_name = aws_route53_record.origin.fqdn
    origin_id   = "eks-alb"
    custom_header {
      name  = "X-Asteriq-Origin"
      value = var.origin_verification_header
    }
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 120
      origin_keepalive_timeout = 60
    }
  }
  default_cache_behavior {
    target_origin_id         = "eks-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.viewer.id
    compress                 = true
  }
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "eks-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.assets.id
    compress               = true
  }
  # Do not cache error responses that might contain personalized failures.
  dynamic "custom_error_response" {
    for_each = toset([400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504])
    content {
      error_code            = custom_error_response.value
      error_caching_min_ttl = 0
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.viewer.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
resource "aws_route53_record" "viewer" {
  for_each = toset(["A", "AAAA"])
  zone_id  = var.zone_id
  name     = var.domain_name
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
resource "aws_route53_record" "additional_viewer" {
  for_each = { for entry in setproduct(toset(var.additional_domain_names), toset(["A", "AAAA"])) : "${entry[0]}-${entry[1]}" => { host = entry[0], type = entry[1] } }
  zone_id  = var.zone_id
  name     = each.value.host
  type     = each.value.type
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
output "distribution_id" { value = aws_cloudfront_distribution.this.id }
output "url" { value = "https://${var.domain_name}" }
output "origin_waf_acl_arn" { value = aws_wafv2_web_acl.origin.arn }
