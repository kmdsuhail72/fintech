variable "account_id" { type = string }
variable "region" { type = string }
variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Choose dev, staging or production."
  }
}
variable "azs" {
  type = list(string)
  validation {
    condition     = length(var.azs) == 3 && length(distinct(var.azs)) == 3
    error_message = "This EKS profile requires three distinct Availability Zones."
  }
}
variable "vpc_cidr" { type = string }
variable "kubernetes_version" { type = string }
variable "node_ami_release_version" { type = string }
variable "addon_versions" {
  type = map(string)
  validation {
    condition     = alltrue([for name in ["vpc-cni", "coredns", "kube-proxy", "aws-ebs-csi-driver", "amazon-cloudwatch-observability"] : contains(keys(var.addon_versions), name)])
    error_message = "Pin all five compatible EKS add-on versions."
  }
}
variable "deployment_role_arn" { type = string }
variable "administrator_role_arn" { type = string }
variable "node_instance_types" {
  type    = list(string)
  default = ["m6i.xlarge"]
}
variable "node_max_per_az" {
  type    = number
  default = 10
}
variable "load_balancer_policy_file" {
  type    = string
  default = "policies/load-balancer-controller-v3.6.0.json"
}
variable "zone_id" { type = string }
variable "domain_name" { type = string }
variable "additional_domain_names" {
  type        = list(string)
  default     = []
  description = "Additional public hostnames covered by the regional ALB certificate."
}
variable "ses_domain" { type = string }
variable "ses_from_address" { type = string }
variable "db_engine_version" { type = string }
variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}
variable "redis_node_type" {
  type    = string
  default = "cache.r6g.large"
}
variable "redis_auth_token" {
  type      = string
  sensitive = true
  ephemeral = true
}
variable "redis_auth_token_version" {
  type    = number
  default = 1
}
