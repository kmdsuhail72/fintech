provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = { Project = "asteriq-ai", Environment = var.environment, ManagedBy = "Terraform" }
  }
}
module "asteriq" {
  depends_on                    = [terraform_data.environment]
  source                        = "../../modules/stack"
  environment                   = var.environment
  database_connection_threshold = var.database_connection_threshold
  region                        = var.region
  account_id                    = var.account_id
  vpc_cidr                      = var.vpc_cidr
  azs                           = var.azs
  zone_id                       = var.zone_id
  domain_name                   = var.domain_name
  auth_email_from               = var.auth_email_from
  images                        = var.images
  nat_per_az                    = var.nat_per_az
  desired_count                 = var.desired_count
  db_instance_class             = var.db_instance_class
  db_engine_version             = var.db_engine_version
  db_storage                    = var.db_storage
  db_multi_az                   = var.db_multi_az
  redis_node_type               = var.redis_node_type
  redis_replicas                = var.redis_replicas
  redis_auth_token_version      = var.redis_auth_token_version
  log_retention_days            = var.log_retention_days
  ingress_cidrs                 = var.ingress_cidrs
  redis_auth_token              = var.redis_auth_token
}
