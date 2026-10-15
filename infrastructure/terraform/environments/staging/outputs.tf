output "deployment" {
  value = {
    cluster_name              = module.asteriq.cluster_name
    migration_task_definition = module.asteriq.migration_task_definition
    service_names             = module.asteriq.service_names
    ecr_urls                  = module.asteriq.ecr_urls
    site_url                  = module.asteriq.site_url
    secret_arns               = module.asteriq.secret_arns
    database_endpoint         = module.asteriq.database_endpoint
    database_admin_secret_arn = module.asteriq.database_admin_secret_arn
    redis_endpoint            = module.asteriq.redis_endpoint
    objects_bucket            = module.asteriq.objects_bucket
    alarm_topic_arn           = module.asteriq.alarm_topic_arn
    execution_role_arns       = module.asteriq.execution_role_arns
    task_role_arns            = module.asteriq.task_role_arns
    observability             = module.asteriq.observability
  }
}
