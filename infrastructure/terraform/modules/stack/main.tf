data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
locals {
  name       = "asteriq-${var.environment}"
  production = var.environment == "production"
}
resource "terraform_data" "guardrails" {
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.account_id && data.aws_region.current.region == var.region
      error_message = "Provider identity does not match the selected environment account/region."
    }
    precondition {
      condition     = contains(["dev", "staging", "production"], var.environment) && length(distinct(var.azs)) >= 2 && length(var.azs) <= 3
      error_message = "Choose dev/staging/production and two or three distinct availability zones."
    }
    precondition {
      condition     = !local.production || (var.nat_per_az && var.db_multi_az && var.redis_replicas >= 1 && var.desired_count >= 2 && var.log_retention_days >= 90)
      error_message = "Production requires per-AZ NAT, Multi-AZ data services, two tasks, and 90-day logs."
    }
    precondition {
      condition     = alltrue([for service in ["web", "api", "ai-service"] : can(regex("^${var.account_id}\\.dkr\\.ecr\\.${var.region}\\.amazonaws\\.com/asteriq-${var.environment}/${service}@sha256:[a-f0-9]{64}$", lookup(var.images, service, "")))])
      error_message = "Supply all three scanned ECR images by immutable digest using this environment's prefix."
    }
  }
}
module "cloudwatch" {
  source         = "../cloudwatch"
  name           = local.name
  retention_days = var.log_retention_days
}
module "vpc" {
  source             = "../vpc"
  name               = local.name
  cidr               = var.vpc_cidr
  azs                = var.azs
  nat_per_az         = var.nat_per_az
  flow_log_group_arn = module.cloudwatch.arns["vpc"]
  depends_on         = [terraform_data.guardrails]
}
module "security" {
  source        = "../security"
  name          = local.name
  vpc_id        = module.vpc.id
  ingress_cidrs = var.ingress_cidrs
}
module "objects" {
  source = "../s3"
  name   = "${local.name}-${var.account_id}-${var.region}-objects"
}
module "access_logs" {
  source         = "../s3"
  name           = "${local.name}-${var.account_id}-${var.region}-access-logs"
  alb_account_id = var.account_id
}
module "route53" {
  source      = "../route53"
  zone_id     = var.zone_id
  domain_name = var.domain_name
}
module "alb" {
  source            = "../alb"
  name              = local.name
  vpc_id            = module.vpc.id
  subnet_ids        = module.vpc.public_subnet_ids
  security_group_id = module.security.ids["alb"]
  certificate_arn   = module.route53.certificate_arn
  log_bucket        = module.access_logs.id
  production        = local.production
  depends_on        = [module.access_logs]
}
resource "aws_route53_record" "application" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"
  alias {
    name                   = module.alb.dns_name
    zone_id                = module.alb.zone_id
    evaluate_target_health = true
  }
}
module "ecr" {
  source = "../ecr"
  prefix = local.name
}
module "secrets" {
  source     = "../secrets"
  name       = local.name
  production = local.production
}
module "rds" {
  source            = "../rds"
  name              = local.name
  subnet_ids        = module.vpc.data_subnet_ids
  security_group_id = module.security.ids["database"]
  instance_class    = var.db_instance_class
  engine_version    = var.db_engine_version
  allocated_storage = var.db_storage
  production        = local.production
  multi_az          = var.db_multi_az
}
module "redis" {
  source             = "../redis"
  name               = local.name
  subnet_ids         = module.vpc.data_subnet_ids
  security_group_id  = module.security.ids["redis"]
  node_type          = var.redis_node_type
  replicas           = var.redis_replicas
  production         = local.production
  auth_token         = var.redis_auth_token
  auth_token_version = var.redis_auth_token_version
}
module "ecs" {
  source             = "../ecs"
  name               = local.name
  environment        = var.environment
  region             = var.region
  vpc_id             = module.vpc.id
  subnet_ids         = module.vpc.private_subnet_ids
  security_group_ids = module.security.ids
  images             = var.images
  ecr_arns           = module.ecr.service_arns
  secret_arns        = module.secrets.arns
  log_names          = module.cloudwatch.names
  log_arns           = module.cloudwatch.arns
  target_group_arn   = module.alb.target_group_arn
  desired_count      = var.desired_count
  domain_name        = var.domain_name
  auth_email_from    = var.auth_email_from
  bucket_arn         = module.objects.arn
  depends_on         = [module.alb]
}
resource "aws_cloudwatch_metric_alarm" "database_storage" {
  alarm_name          = "${local.name}-database-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 5368709120
  dimensions          = { DBInstanceIdentifier = module.rds.identifier }
  alarm_actions       = [module.cloudwatch.alarm_topic_arn]
}
resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  alarm_name          = "${local.name}-unhealthy-web-targets"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  dimensions          = { LoadBalancer = module.alb.arn_suffix, TargetGroup = module.alb.target_group_suffix }
  alarm_actions       = [module.cloudwatch.alarm_topic_arn]
}
