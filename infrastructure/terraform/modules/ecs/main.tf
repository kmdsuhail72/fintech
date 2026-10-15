data "aws_caller_identity" "current" {}
locals {
  services = {
    web        = { port = 8080, cpu = 256, memory = 512, health = "wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1" }
    api        = { port = 3000, cpu = 512, memory = 1024, health = "node -e \"fetch('http://127.0.0.1:3000/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"" }
    ai-service = { port = 8000, cpu = 1024, memory = 4096, health = "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=3)\"" }
  }
  namespace = "${var.name}.internal"
  environments = {
    web = { API_UPSTREAM = "http://api.${local.namespace}:3000" }
    api = {
      NODE_ENV            = "production", API_PORT = "3000", RUN_MIGRATIONS = "false",
      TRUST_PROXY_HOPS    = "2",
      ASTERIQ_ENVIRONMENT = var.environment, OBSERVABILITY_ENABLED = "true",
      AI_SERVICE_URL      = "http://ai-service.${local.namespace}:8000",
      CORS_ORIGINS        = "https://${var.domain_name}", AUTH_WEB_URL = "https://${var.domain_name}",
      AUTH_EMAIL_FROM     = var.auth_email_from, DEV_AUTH_TOKEN_OUTPUT = "false"
    }
    ai-service = { APP_ENV = "production", NEWS_SENTIMENT_ENABLED = "false", ASTERIQ_ENVIRONMENT = var.environment, OBSERVABILITY_ENABLED = "true", RESEARCH_BACKEND_URL = "http://api.${local.namespace}:3000/api/v1" }
  }
  secrets = {
    web        = {}
    api        = { DATABASE_URL = "database-url", REDIS_URL = "redis-url", JWT_ACCESS_SECRET = "jwt", SMTP_URL = "smtp" }
    ai-service = { RAG_DATABASE_URL = "rag-database-url", OPENAI_API_KEY = "openai" }
  }
  assume_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole",
    Condition = {
      StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id },
      ArnLike      = { "aws:SourceArn" = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:*" }
    }
  }] })
}
resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
resource "aws_service_discovery_private_dns_namespace" "this" {
  name = local.namespace
  vpc  = var.vpc_id
}
resource "aws_service_discovery_service" "this" {
  for_each = local.services
  name     = each.key
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
  health_check_custom_config {}
}
resource "aws_iam_role" "execution" {
  for_each           = local.services
  name               = "${var.name}-${each.key}-execution"
  assume_role_policy = local.assume_policy
}
resource "aws_iam_role_policy" "execution" {
  for_each = local.services
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = var.ecr_arns[each.key] },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${var.log_arns[each.key]}:*" }
  ] })
}
resource "aws_iam_role_policy" "secrets" {
  for_each = { for name, mapping in local.secrets : name => mapping if length(mapping) > 0 }
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow", Action = ["secretsmanager:GetSecretValue"],
    Resource = [for secret in values(each.value) : var.secret_arns[secret]]
  }] })
}
resource "aws_iam_role" "task" {
  for_each           = local.services
  name               = "${var.name}-${each.key}-task"
  assume_role_policy = local.assume_policy
}
resource "aws_iam_role_policy" "storage" {
  for_each = toset(["api", "ai-service"])
  role     = aws_iam_role.task[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = var.bucket_arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${var.bucket_arn}/*" }
  ] })
}
resource "aws_ecs_task_definition" "this" {
  depends_on               = [aws_iam_role_policy.execution, aws_iam_role_policy.secrets, aws_iam_role_policy.storage]
  for_each                 = local.services
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.task[each.key].arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name         = each.key, image = var.images[each.key], essential = true,
    portMappings = [{ containerPort = each.value.port, protocol = "tcp" }],
    environment  = [for name, value in local.environments[each.key] : { name = name, value = value }],
    secrets      = [for name, secret in local.secrets[each.key] : { name = name, valueFrom = var.secret_arns[secret] }],
    healthCheck  = { command = ["CMD-SHELL", each.value.health], interval = 30, timeout = 5, retries = 3, startPeriod = 60 },
    logConfiguration = { logDriver = "awslogs", options = {
      awslogs-group = var.log_names[each.key], awslogs-region = var.region, awslogs-stream-prefix = "ecs"
    } }
  }])
}
resource "aws_iam_role" "migration_execution" {
  name               = "${var.name}-migration-execution"
  assume_role_policy = local.assume_policy
}
resource "aws_iam_role" "migration_task" {
  name               = "${var.name}-migration-task"
  assume_role_policy = local.assume_policy
}
resource "aws_iam_role_policy" "migration_execution" {
  role = aws_iam_role.migration_execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = var.ecr_arns["api"] },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${var.log_arns["api"]}:*" },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = var.secret_arns["migration-database-url"] }
  ] })
}
resource "aws_ecs_task_definition" "migration" {
  depends_on               = [aws_iam_role_policy.migration_execution]
  family                   = "${var.name}-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.migration_execution.arn
  task_role_arn            = aws_iam_role.migration_task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name        = "api", image = var.images["api"], essential = true,
    command     = ["node", "/workspace/scripts/migrate.mjs"],
    environment = [{ name = "RUN_MIGRATIONS", value = "false" }],
    secrets     = [{ name = "DATABASE_URL", valueFrom = var.secret_arns["migration-database-url"] }],
    logConfiguration = { logDriver = "awslogs", options = {
      awslogs-group = var.log_names["api"], awslogs-region = var.region, awslogs-stream-prefix = "migration"
    } }
  }])
}
resource "aws_ecs_service" "this" {
  for_each                           = local.services
  name                               = "${var.name}-${each.key}"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.this[each.key].arn
  desired_count                      = var.desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  availability_zone_rebalancing      = "ENABLED"
  health_check_grace_period_seconds  = each.key == "web" ? 60 : null
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_ids[each.key]]
    assign_public_ip = false
  }
  service_registries {
    registry_arn = aws_service_discovery_service.this[each.key].arn
  }
  dynamic "load_balancer" {
    for_each = each.key == "web" ? [1] : []
    content {
      target_group_arn = var.target_group_arn
      container_name   = "web"
      container_port   = 8080
    }
  }
  # GitHub CD owns promoted task revisions; autoscaling owns desired count.
  lifecycle { ignore_changes = [task_definition, desired_count] }
  depends_on = [aws_iam_role_policy.execution, aws_iam_role_policy.secrets]
}
resource "aws_appautoscaling_target" "this" {
  for_each           = local.services
  min_capacity       = var.desired_count
  max_capacity       = var.desired_count * 4
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.this[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}
resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.services
  name               = "${var.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.this[each.key].scalable_dimension
  service_namespace  = "ecs"
  target_tracking_scaling_policy_configuration {
    target_value       = 65
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}
