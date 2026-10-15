resource "terraform_data" "environment" {
  lifecycle {
    precondition {
      condition     = var.environment == "production"
      error_message = "This root only manages production."
    }
  }
}
