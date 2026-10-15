resource "aws_s3_bucket" "this" {
  bucket        = var.name
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration { status = "Enabled" }
}
# SSE-S3 supports ALB access-log delivery. State uses a separate KMS bucket.
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}
resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([{
    Sid       = "RequireTLS", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }], var.alb_account_id == null ? [] : [{
    Sid       = "ALBLogDelivery", Effect = "Allow",
    Principal = { Service = "logdelivery.elasticloadbalancing.amazonaws.com" },
    Action    = "s3:PutObject", Resource = "${aws_s3_bucket.this.arn}/alb/AWSLogs/${var.alb_account_id}/*"
  }]) })
}
