output "cluster_name" {
  value = module.ecs.cluster_name
}
output "migration_task_definition" {
  value = module.ecs.migration_task_definition
}
output "observability" {
  value = { dashboards = module.observability.dashboard_names, slos = module.observability.slo_definitions }
}
output "service_names" {
  value = module.ecs.service_names
}
output "ecr_urls" {
  value = module.ecr.urls
}
output "secret_arns" {
  value = module.secrets.arns
}
output "database_endpoint" {
  value = module.rds.endpoint
}
output "database_admin_secret_arn" {
  value = module.rds.master_secret_arn
}
output "redis_endpoint" {
  value = module.redis.endpoint
}
output "objects_bucket" {
  value = module.objects.id
}
output "alarm_topic_arn" {
  value = module.cloudwatch.alarm_topic_arn
}
output "site_url" {
  value = "https://${var.domain_name}"
}
output "execution_role_arns" {
  value = module.ecs.execution_role_arns
}
output "task_role_arns" {
  value = module.ecs.task_role_arns
}
