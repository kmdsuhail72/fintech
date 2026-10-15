variable "account_id" { type = string }
variable "region" { type = string }
variable "environment" { type = string }
variable "zone_id" { type = string }
variable "domain_name" { type = string }
variable "additional_domain_names" {
  type    = list(string)
  default = []
}
variable "additional_certificate_validation_record_fqdns" {
  type        = list(string)
  default     = []
  description = "Foundation-owned DNS validation FQDNs for additional viewer hostnames."
}
variable "origin_alb_name" { type = string }
variable "certificate_validation_record_fqdn" { type = string }
variable "origin_verification_header" {
  type        = string
  sensitive   = true
  description = "Random per-distribution origin credential, managed out of source control. Stored in encrypted Terraform state."
  validation {
    condition     = length(var.origin_verification_header) >= 32
    error_message = "Use at least 32 cryptographically random characters."
  }
}
variable "waf_rate_limit" {
  type    = number
  default = 2000
}
