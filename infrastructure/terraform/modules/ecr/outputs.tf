output "urls" {
  value = { for name, repo in aws_ecr_repository.this : name => repo.repository_url }
}
output "arns" {
  value = [for repo in aws_ecr_repository.this : repo.arn]
}
output "service_arns" {
  value = { for name, repo in aws_ecr_repository.this : name => repo.arn }
}
