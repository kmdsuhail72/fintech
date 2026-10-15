variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "ingress_cidrs" {
  type = set(string)
}
