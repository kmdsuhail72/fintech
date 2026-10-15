resource "aws_lb" "this" {
  name                       = var.name
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [var.security_group_id]
  subnets                    = var.subnet_ids
  enable_deletion_protection = var.production
  drop_invalid_header_fields = true
  idle_timeout               = 200
  access_logs {
    bucket  = var.log_bucket
    prefix  = "alb"
    enabled = true
  }
}
resource "aws_lb_target_group" "web" {
  name                 = "${var.name}-web"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  port                 = 8080
  protocol             = "HTTP"
  deregistration_delay = 30
  health_check {
    path    = "/health"
    matcher = "200"
  }
  stickiness {
    type            = "lb_cookie"
    enabled         = true
    cookie_duration = 86400
  }
}
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}
