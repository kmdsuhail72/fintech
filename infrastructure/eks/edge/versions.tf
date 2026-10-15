terraform {
  required_version = ">= 1.11, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.68" }
  }
  backend "s3" {}
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
}
provider "aws" {
  alias               = "edge"
  region              = "us-east-1"
  allowed_account_ids = [var.account_id]
}
