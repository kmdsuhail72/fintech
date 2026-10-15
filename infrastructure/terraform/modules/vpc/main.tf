resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-unused-default" }
}
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}
locals {
  zones     = { for index, zone in var.azs : zone => index }
  nat_zones = var.nat_per_az ? local.zones : { (var.azs[0]) = 0 }
}
resource "aws_subnet" "public" {
  for_each                = local.zones
  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.cidr, 4, each.value)
  map_public_ip_on_launch = false
  tags = merge({ Name = "${var.name}-public-${each.key}" }, var.kubernetes_cluster_name == null ? {} : {
    "kubernetes.io/role/elb"                               = "1"
    "kubernetes.io/cluster/${var.kubernetes_cluster_name}" = "shared"
  })
}
resource "aws_subnet" "application" {
  for_each          = local.zones
  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.cidr, 4, each.value + 4)
  tags = merge({ Name = "${var.name}-application-${each.key}" }, var.kubernetes_cluster_name == null ? {} : {
    "kubernetes.io/role/internal-elb"                      = "1"
    "kubernetes.io/cluster/${var.kubernetes_cluster_name}" = "shared"
    "karpenter.sh/discovery"                               = var.kubernetes_cluster_name
  })
}
resource "aws_subnet" "data" {
  for_each          = local.zones
  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.cidr, 4, each.value + 8)
  tags              = { Name = "${var.name}-data-${each.key}" }
}
resource "aws_eip" "nat" {
  for_each = local.nat_zones
  domain   = "vpc"
}
resource "aws_nat_gateway" "this" {
  for_each      = local.nat_zones
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id
  depends_on    = [aws_internet_gateway.this]
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
}
resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}
resource "aws_route_table_association" "public" {
  for_each       = local.zones
  subnet_id      = aws_subnet.public[each.key].id
  route_table_id = aws_route_table.public.id
}
resource "aws_route_table" "application" {
  for_each = local.zones
  vpc_id   = aws_vpc.this.id
}
resource "aws_route" "nat" {
  for_each               = local.zones
  route_table_id         = aws_route_table.application[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[var.nat_per_az ? each.key : var.azs[0]].id
}
resource "aws_route_table_association" "application" {
  for_each       = local.zones
  subnet_id      = aws_subnet.application[each.key].id
  route_table_id = aws_route_table.application[each.key].id
}
resource "aws_route_table" "data" {
  for_each = local.zones
  vpc_id   = aws_vpc.this.id
}
resource "aws_route_table_association" "data" {
  for_each       = local.zones
  subnet_id      = aws_subnet.data[each.key].id
  route_table_id = aws_route_table.data[each.key].id
}
data "aws_region" "current" {}
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for table in aws_route_table.application : table.id]
}
resource "aws_iam_role" "flow" {
  name = "${var.name}-flow-logs"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "vpc-flow-logs.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy" "flow" {
  role = aws_iam_role.flow.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"],
    Resource = "${var.flow_log_group_arn}:*"
    }, {
    Effect = "Allow", Action = ["logs:DescribeLogGroups"], Resource = "*"
  }] })
}
resource "aws_flow_log" "this" {
  vpc_id          = aws_vpc.this.id
  traffic_type    = "ALL"
  iam_role_arn    = aws_iam_role.flow.arn
  log_destination = var.flow_log_group_arn
  depends_on      = [aws_iam_role_policy.flow]
}
