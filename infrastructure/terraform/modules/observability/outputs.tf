output "dashboard_names" {
  value = [aws_cloudwatch_dashboard.operations.dashboard_name, aws_cloudwatch_dashboard.slos.dashboard_name]
}
output "slo_definitions" {
  value = local.slos
}
