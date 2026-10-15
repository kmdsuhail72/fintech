output "endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}
output "id" {
  value = aws_elasticache_replication_group.this.id
}
