output "endpoint" {
  value = aws_db_instance.this.address
}
output "master_secret_arn" {
  value = aws_db_instance.this.master_user_secret[0].secret_arn
}
output "identifier" {
  value = aws_db_instance.this.id
}
