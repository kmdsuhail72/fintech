resource "terraform_data" "environment" {
  lifecycle {
    precondition {
      condition     = var.environment == "staging"
      error_message = "This root only manages staging."
    }
  }
}
