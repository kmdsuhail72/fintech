resource "terraform_data" "environment" {
  lifecycle {
    precondition {
      condition     = var.environment == "dev"
      error_message = "This root only manages dev."
    }
  }
}
