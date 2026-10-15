output "cluster_name" {
  value = aws_ecs_cluster.this.name
}
output "service_names" {
  value = { for name, service in aws_ecs_service.this : name => service.name }
}
output "task_role_arns" {
  value = concat([for role in aws_iam_role.task : role.arn], [aws_iam_role.migration_task.arn])
}
output "execution_role_arns" {
  value = concat([for role in aws_iam_role.execution : role.arn], [aws_iam_role.migration_execution.arn])
}
output "migration_task_definition" {
  value = aws_ecs_task_definition.migration.arn
}
