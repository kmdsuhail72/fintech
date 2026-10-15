resource "aws_acm_certificate" "origin" {
  domain_name               = var.domain_name
  subject_alternative_names = distinct(concat(["origin.${var.domain_name}"], var.additional_domain_names))
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}
resource "aws_route53_record" "certificate" {
  for_each = toset(concat([var.domain_name, "origin.${var.domain_name}"], var.additional_domain_names))
  zone_id  = var.zone_id
  name     = one([for option in aws_acm_certificate.origin.domain_validation_options : option if option.domain_name == each.value]).resource_record_name
  type     = one([for option in aws_acm_certificate.origin.domain_validation_options : option if option.domain_name == each.value]).resource_record_type
  records  = [one([for option in aws_acm_certificate.origin.domain_validation_options : option if option.domain_name == each.value]).resource_record_value]
  ttl      = 60
}
resource "aws_acm_certificate_validation" "origin" {
  certificate_arn         = aws_acm_certificate.origin.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate : record.fqdn]
}
