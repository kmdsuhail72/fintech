output "ids" {
  value = { for name, group in aws_security_group.this : name => group.id }
}
