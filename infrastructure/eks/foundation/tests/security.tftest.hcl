mock_provider "aws" {}
variables {
  account_id               = "123456789012"
  region                   = "ap-south-1"
  environment              = "production"
  azs                      = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
  vpc_cidr                 = "10.80.0.0/16"
  kubernetes_version       = "1.35"
  node_ami_release_version = "1.35.0-20260901"
  addon_versions           = { vpc-cni = "v1.0.0-eksbuild.1", coredns = "v1.0.0-eksbuild.1", kube-proxy = "v1.0.0-eksbuild.1", aws-ebs-csi-driver = "v1.0.0-eksbuild.1", amazon-cloudwatch-observability = "v1.0.0-eksbuild.1" }
  deployment_role_arn      = "arn:aws:iam::123456789012:role/deployment"
  administrator_role_arn   = "arn:aws:iam::123456789012:role/administrator"
  zone_id                  = "Z0123456789"
  domain_name              = "asteriq.test.example.org"
  ses_domain               = "test.example.org"
  ses_from_address         = "alerts@test.example.org"
  db_engine_version        = "16.8"
  redis_auth_token         = "syntheticTestOnlyNeverARealSecret12345"
}
run "dual_domain_https_certificate" {
  command = plan
  variables {
    domain_name             = "app.asteriq.ai"
    additional_domain_names = ["api.asteriq.ai"]
  }
  assert {
    condition     = aws_acm_certificate.origin.domain_name == "app.asteriq.ai" && contains(aws_acm_certificate.origin.subject_alternative_names, "api.asteriq.ai") && length(aws_route53_record.certificate) == 3
    error_message = "Validate app, API and origin hostnames on the regional certificate."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.certificate_expiry.threshold == 30 && aws_cloudwatch_metric_alarm.certificate_expiry.metric_name == "DaysToExpiry"
    error_message = "Monitor managed certificate expiry at 30 days."
  }
}
run "private_multi_az_foundation" {
  command = plan
  assert {
    condition     = aws_eks_access_policy_association.operator["deployment"].access_scope[0].type == "namespace" && aws_eks_access_policy_association.operator["deployment"].access_scope[0].namespaces == toset(["asteriq-production"])
    error_message = "Application deployment access must not administer the whole cluster."
  }
  assert {
    condition     = aws_eks_cluster.this.vpc_config[0].endpoint_private_access && !aws_eks_cluster.this.vpc_config[0].endpoint_public_access
    error_message = "EKS API must be private only."
  }
  assert {
    condition     = length(aws_eks_node_group.this) == 3 && alltrue([for group in aws_eks_node_group.this : length(group.subnet_ids) == 1 && group.capacity_type == "ON_DEMAND"])
    error_message = "Use an on-demand baseline in each of three AZs."
  }
  assert {
    condition     = aws_launch_template.nodes.metadata_options[0].http_tokens == "required" && aws_launch_template.nodes.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "Require IMDSv2 and prevent ordinary pods from accessing node credentials."
  }
  assert {
    condition     = aws_eks_cluster.this.access_config[0].authentication_mode == "API" && !aws_eks_cluster.this.access_config[0].bootstrap_cluster_creator_admin_permissions
    error_message = "Only explicitly granted operator roles should administer Kubernetes."
  }
  assert {
    condition     = length(aws_eks_cluster.this.enabled_cluster_log_types) == 5 && aws_eks_cluster.this.deletion_protection
    error_message = "Enable all control-plane audit logs and deletion protection."
  }
}
