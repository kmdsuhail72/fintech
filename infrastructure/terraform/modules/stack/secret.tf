variable "redis_auth_token" {
  type      = string
  sensitive = true
  ephemeral = true
}
