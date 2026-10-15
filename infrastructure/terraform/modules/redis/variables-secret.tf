variable "auth_token" {
  type        = string
  sensitive   = true
  ephemeral   = true
  description = "Supply securely using TF_VAR_redis_auth_token; never stored in state."
  validation {
    condition     = can(regex("^[A-Za-z0-9]{32,128}$", var.auth_token))
    error_message = "Use a cryptographically random alphanumeric token of 32-128 characters."
  }
}
