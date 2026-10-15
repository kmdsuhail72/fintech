variable "name" { type = string }
variable "environment" { type = string }
variable "region" { type = string }
variable "cluster_name" { type = string }
variable "services" { type = map(string) }
variable "minimum_task_count" { type = number }
variable "database_id" { type = string }
variable "redis_cluster_ids" { type = list(string) }
variable "alb_suffix" { type = string }
variable "target_group_suffix" { type = string }
variable "log_groups" { type = map(string) }
variable "alarm_topic_arn" { type = string }
variable "database_connection_threshold" {
  type    = number
  default = 100
}
