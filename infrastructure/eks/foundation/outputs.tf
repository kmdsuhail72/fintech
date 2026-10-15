output "cluster_name" { value = aws_eks_cluster.this.name }
output "certificate_validation_record_fqdn" { value = aws_route53_record.certificate[var.domain_name].fqdn }
output "certificate_validation_records" { value = { for name, record in aws_route53_record.certificate : name => record.fqdn } }
output "vpc_id" { value = module.vpc.id }
output "subnets" { value = { public = module.vpc.public_subnet_ids, private = module.vpc.private_subnet_ids, data = module.vpc.data_subnet_ids } }
output "subnet_cidrs" {
  value = { public = [for i in range(3) : cidrsubnet(var.vpc_cidr, 4, i)], data = [for i in range(3) : cidrsubnet(var.vpc_cidr, 4, i + 8)] }
}
output "irsa_roles" { value = { for name, role in aws_iam_role.irsa : name => role.arn } }
output "alb_security_group_id" { value = aws_security_group.alb.id }
output "alb_certificate_arn" { value = aws_acm_certificate_validation.origin.certificate_arn }
output "rds_endpoint" { value = module.rds.endpoint }
output "rds_admin_secret_arn" { value = module.rds.master_secret_arn }
output "redis_endpoint" { value = module.redis.endpoint }
output "application_secret_arns" { value = module.secrets.arns }
output "object_bucket" { value = module.objects.id }
output "alb_log_bucket" { value = module.access_logs.id }
output "ecr_repositories" { value = module.ecr.urls }
output "ses_smtp_user" { value = aws_iam_user.ses_smtp.name }
