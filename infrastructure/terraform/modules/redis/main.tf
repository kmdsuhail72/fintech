resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}
resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "Asteriq cache and Socket.IO coordination"
  engine                     = "redis"
  engine_version             = "7.1"
  parameter_group_name       = "default.redis7"
  node_type                  = var.node_type
  port                       = 6379
  num_cache_clusters         = 1 + var.replicas
  automatic_failover_enabled = var.replicas > 0
  multi_az_enabled           = var.replicas > 0
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [var.security_group_id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token_wo              = var.auth_token
  auth_token_wo_version      = var.auth_token_version
  auth_token_update_strategy = "SET"
  snapshot_retention_limit   = var.production ? 7 : 1
  snapshot_window            = "03:00-04:00"
  maintenance_window         = "sun:05:00-sun:06:00"
  apply_immediately          = false
}
