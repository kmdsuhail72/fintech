locals {
  groups = toset(["alb", "web", "api", "ai-service", "database", "redis"])
  internal_rules = {
    alb_web   = { source = "alb", target = "web", port = 8080 }
    web_api   = { source = "web", target = "api", port = 3000 }
    api_ai    = { source = "api", target = "ai-service", port = 8000 }
    ai_api    = { source = "ai-service", target = "api", port = 3000 }
    api_db    = { source = "api", target = "database", port = 5432 }
    ai_db     = { source = "ai-service", target = "database", port = 5432 }
    api_redis = { source = "api", target = "redis", port = 6379 }
  }
}
resource "aws_security_group" "this" {
  for_each    = local.groups
  name_prefix = "${var.name}-${each.key}-"
  description = "Asteriq ${each.key}; rules managed separately"
  vpc_id      = var.vpc_id
  lifecycle { create_before_destroy = true }
}
resource "aws_vpc_security_group_ingress_rule" "https" {
  for_each          = var.ingress_cidrs
  security_group_id = aws_security_group.this["alb"].id
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
resource "aws_vpc_security_group_ingress_rule" "internal" {
  for_each                     = local.internal_rules
  security_group_id            = aws_security_group.this[each.value.target].id
  referenced_security_group_id = aws_security_group.this[each.value.source].id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}
resource "aws_vpc_security_group_egress_rule" "internal" {
  for_each                     = local.internal_rules
  security_group_id            = aws_security_group.this[each.value.source].id
  referenced_security_group_id = aws_security_group.this[each.value.target].id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}
resource "aws_vpc_security_group_egress_rule" "https" {
  for_each          = toset(["web", "api", "ai-service"])
  security_group_id = aws_security_group.this[each.key].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
# Existing API uses Nodemailer SMTP; allow encrypted SES submission.
resource "aws_vpc_security_group_egress_rule" "smtp" {
  security_group_id = aws_security_group.this["api"].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 587
  to_port           = 587
}
