variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "azs" {
  type = list(string)
}

variable "zone_id" {
  type = string
}

variable "domain_name" {
  type = string
}

variable "auth_email_from" {
  type = string
}

variable "images" {
  type = map(string)
}

variable "nat_per_az" {
  type    = bool
  default = true
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_engine_version" {
  type    = string
  default = "16"
}

variable "db_storage" {
  type    = number
  default = 30
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "redis_replicas" {
  type    = number
  default = 1
}

variable "redis_auth_token_version" {
  type    = number
  default = 1
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "ingress_cidrs" {
  type    = set(string)
  default = ["0.0.0.0/0"]
}
variable "database_connection_threshold" {
  type    = number
  default = 100
}
variable "redis_auth_token" {
  type      = string
  sensitive = true
  ephemeral = true
}
