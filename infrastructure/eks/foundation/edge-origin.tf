data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
resource "aws_security_group" "alb" {
  name        = "${local.name}-cloudfront-alb"
  vpc_id      = module.vpc.id
  description = "HTTPS only from CloudFront origin-facing addresses"
}
resource "aws_vpc_security_group_ingress_rule" "cloudfront" {
  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "alb" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}
resource "aws_vpc_security_group_ingress_rule" "frontend" {
  security_group_id            = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}
resource "aws_ses_domain_identity" "this" { domain = var.ses_domain }
resource "aws_route53_record" "ses_verification" {
  zone_id = var.zone_id
  name    = "_amazonses.${var.ses_domain}"
  type    = "TXT"
  ttl     = 300
  records = [aws_ses_domain_identity.this.verification_token]
}
resource "aws_ses_domain_dkim" "this" { domain = aws_ses_domain_identity.this.domain }
resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = var.zone_id
  name    = "${aws_ses_domain_dkim.this.dkim_tokens[count.index]}._domainkey.${var.ses_domain}"
  type    = "CNAME"
  ttl     = 300
  records = ["${aws_ses_domain_dkim.this.dkim_tokens[count.index]}.dkim.amazonses.com"]
}
resource "aws_ses_domain_mail_from" "this" {
  domain                 = aws_ses_domain_identity.this.domain
  mail_from_domain       = "mail.${var.ses_domain}"
  behavior_on_mx_failure = "RejectMessage"
}
resource "aws_route53_record" "mail_mx" {
  zone_id = var.zone_id
  name    = aws_ses_domain_mail_from.this.mail_from_domain
  type    = "MX"
  ttl     = 300
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}
resource "aws_route53_record" "mail_spf" {
  zone_id = var.zone_id
  name    = aws_ses_domain_mail_from.this.mail_from_domain
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com -all"]
}
