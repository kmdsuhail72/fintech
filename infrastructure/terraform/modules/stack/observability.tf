module "observability" {
  source                        = "../observability"
  name                          = local.name
  environment                   = var.environment
  region                        = var.region
  cluster_name                  = module.ecs.cluster_name
  services                      = module.ecs.service_names
  minimum_task_count            = var.desired_count
  database_connection_threshold = var.database_connection_threshold
  database_id                   = module.rds.identifier
  redis_cluster_ids             = [for index in range(1 + var.redis_replicas) : format("%s-%03d", local.name, index + 1)]
  alb_suffix                    = module.alb.arn_suffix
  target_group_suffix           = module.alb.target_group_suffix
  log_groups                    = module.cloudwatch.names
  alarm_topic_arn               = module.cloudwatch.alarm_topic_arn
}
