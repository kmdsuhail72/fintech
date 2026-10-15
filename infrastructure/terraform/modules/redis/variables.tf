variable "name" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "node_type" {
  type = string
}

variable "replicas" {
  type = number
}

variable "production" {
  type = bool
}

variable "auth_token_version" {
  type = number
}
