resource "aws_ecr_repository" "this" {
  for_each             = toset(["web", "api", "ai-service"])
  name                 = "${var.prefix}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  encryption_configuration { encryption_type = "AES256" }
  image_scanning_configuration { scan_on_push = true }
}
resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({ rules = [{ rulePriority = 1, description = "Remove old untagged images",
    selection = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 },
    action    = { type = "expire" }
  }] })
}
