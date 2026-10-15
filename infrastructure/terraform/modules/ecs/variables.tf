variable "name" {
  type = string
}
variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = map(string)
}

variable "images" {
  type = map(string)
}
variable "ecr_arns" {
  type = map(string)
}

variable "secret_arns" {
  type = map(string)
}

variable "log_names" {
  type = map(string)
}

variable "log_arns" {
  type = map(string)
}

variable "target_group_arn" {
  type = string
}

variable "desired_count" {
  type = number
}

variable "domain_name" {
  type = string
}

variable "bucket_arn" {
  type = string
}

variable "auth_email_from" {
  type = string
}
