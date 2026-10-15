resource "aws_acm_certificate" "this" {
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}
resource "aws_route53_record" "validation" {
  zone_id = var.zone_id
  name    = one(aws_acm_certificate.this.domain_validation_options).resource_record_name
  type    = one(aws_acm_certificate.this.domain_validation_options).resource_record_type
  records = [one(aws_acm_certificate.this.domain_validation_options).resource_record_value]
  ttl     = 60
}
resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [aws_route53_record.validation.fqdn]
}
