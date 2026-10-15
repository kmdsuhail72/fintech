# Values are populated out of band and never read into Terraform state.
resource "aws_secretsmanager_secret" "this" {
  for_each                = toset(["database-url", "migration-database-url", "rag-database-url", "redis-url", "jwt", "openai", "smtp"])
  name                    = "${var.name}/${each.key}"
  recovery_window_in_days = var.production ? 30 : 7
}
