variable "name" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "instance_class" {
  type = string
}

variable "production" {
  type = bool
}

variable "multi_az" {
  type = bool
}

variable "engine_version" {
  type = string
}

variable "allocated_storage" {
  type = number
}
