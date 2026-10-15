variable "name" {
  type = string
}

variable "cidr" {
  type = string
}

variable "azs" {
  type = list(string)
}

variable "nat_per_az" {
  type    = bool
  default = true
}

variable "flow_log_group_arn" {
  type = string
}

variable "kubernetes_cluster_name" {
  type        = string
  default     = null
  description = "Optional EKS discovery tags; existing ECS callers remain unchanged."
}
