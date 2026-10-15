resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}
resource "aws_db_parameter_group" "this" {
  name   = var.name
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}
resource "aws_db_instance" "this" {
  identifier                      = var.name
  engine                          = "postgres"
  engine_version                  = var.engine_version
  instance_class                  = var.instance_class
  db_name                         = "asteriq"
  username                        = "asteriq_admin"
  manage_master_user_password     = true
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [var.security_group_id]
  parameter_group_name            = aws_db_parameter_group.this.name
  allocated_storage               = var.allocated_storage
  max_allocated_storage           = var.allocated_storage * 5
  storage_type                    = "gp3"
  storage_encrypted               = true
  publicly_accessible             = false
  multi_az                        = var.multi_az
  backup_retention_period         = var.production ? 35 : 7
  backup_window                   = "02:00-03:00"
  maintenance_window              = "sun:04:00-sun:05:00"
  auto_minor_version_upgrade      = true
  apply_immediately               = false
  deletion_protection             = var.production
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.name}-final"
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
}
