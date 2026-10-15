locals {
  name      = "asteriq-${var.environment}-eks"
  namespace = "asteriq-${var.environment}"
}
module "cloudwatch" {
  source         = "../../terraform/modules/cloudwatch"
  name           = local.name
  retention_days = 90
}
module "vpc" {
  source                  = "../../terraform/modules/vpc"
  name                    = local.name
  cidr                    = var.vpc_cidr
  azs                     = var.azs
  nat_per_az              = true
  flow_log_group_arn      = module.cloudwatch.arns["vpc"]
  kubernetes_cluster_name = local.name
}
module "objects" {
  source = "../../terraform/modules/s3"
  name   = "${local.name}-${var.account_id}-${var.region}-objects"
}
module "access_logs" {
  source         = "../../terraform/modules/s3"
  name           = "${local.name}-${var.account_id}-${var.region}-alb-logs"
  alb_account_id = var.account_id
}
module "ecr" {
  source = "../../terraform/modules/ecr"
  prefix = local.name
}
module "secrets" {
  source     = "../../terraform/modules/secrets"
  name       = local.namespace
  production = true
}
resource "aws_security_group" "data" {
  for_each    = toset(["database", "redis"])
  name        = "${local.name}-${each.key}"
  vpc_id      = module.vpc.id
  description = "Private data access from EKS nodes only; pod NetworkPolicy narrows applications"
}
resource "aws_vpc_security_group_ingress_rule" "data" {
  for_each                     = { database = 5432, redis = 6379 }
  security_group_id            = aws_security_group.data[each.key].id
  referenced_security_group_id = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}
module "rds" {
  source            = "../../terraform/modules/rds"
  name              = local.name
  subnet_ids        = module.vpc.data_subnet_ids
  security_group_id = aws_security_group.data["database"].id
  instance_class    = var.db_instance_class
  engine_version    = var.db_engine_version
  allocated_storage = 100
  production        = true
  multi_az          = true
}
module "redis" {
  source             = "../../terraform/modules/redis"
  name               = local.name
  subnet_ids         = module.vpc.data_subnet_ids
  security_group_id  = aws_security_group.data["redis"].id
  node_type          = var.redis_node_type
  replicas           = 2
  production         = true
  auth_token         = var.redis_auth_token
  auth_token_version = var.redis_auth_token_version
}
# AWS service endpoints stay private. External LLM and SMTP still use per-AZ NAT.
resource "aws_security_group" "endpoints" {
  name   = "${local.name}-endpoints"
  vpc_id = module.vpc.id
}
resource "aws_vpc_security_group_ingress_rule" "endpoints" {
  security_group_id            = aws_security_group.endpoints.id
  referenced_security_group_id = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}
resource "aws_vpc_endpoint" "interface" {
  for_each            = toset(["ecr.api", "ecr.dkr", "sts", "secretsmanager", "logs", "ec2", "autoscaling"])
  vpc_id              = module.vpc.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = module.vpc.private_subnet_ids
  security_group_ids  = [aws_security_group.endpoints.id]
}
