variable "region" { type = string }
variable "account_id" { type = string }
variable "bucket_name" { type = string }
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags { tags = { Project = "asteriq-ai", ManagedBy = "Terraform", Purpose = "state" } }
}
resource "aws_kms_key" "state" {
  description             = "Asteriq Terraform state encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket" "state" {
  bucket        = var.bucket_name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
  }
}
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
output "bucket_name" { value = aws_s3_bucket.state.id }
output "kms_key_arn" { value = aws_kms_key.state.arn }
