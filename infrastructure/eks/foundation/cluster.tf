resource "aws_iam_role" "cluster" {
  name               = "${local.name}-control-plane"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "eks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}
resource "aws_kms_key" "cluster" {
  description             = "${local.name} Kubernetes Secret envelope encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_cloudwatch_log_group" "control_plane" {
  name              = "/aws/eks/${local.name}/cluster"
  retention_in_days = 90
}
resource "aws_eks_cluster" "this" {
  name                      = local.name
  role_arn                  = aws_iam_role.cluster.arn
  version                   = var.kubernetes_version
  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  deletion_protection       = true
  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = false
  }
  vpc_config {
    subnet_ids              = module.vpc.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = false
  }
  encryption_config {
    resources = ["secrets"]
    provider { key_arn = aws_kms_key.cluster.arn }
  }
  depends_on = [aws_iam_role_policy_attachment.cluster, aws_cloudwatch_log_group.control_plane]
}
resource "aws_eks_access_entry" "operator" {
  for_each      = { deployment = var.deployment_role_arn, administrator = var.administrator_role_arn }
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  type          = "STANDARD"
}
resource "aws_eks_access_policy_association" "operator" {
  for_each      = aws_eks_access_entry.operator
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value.principal_arn
  policy_arn    = each.key == "administrator" ? "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy" : "arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy"
  access_scope {
    type       = each.key == "administrator" ? "cluster" : "namespace"
    namespaces = each.key == "administrator" ? null : [local.namespace]
  }
}
resource "aws_iam_role" "nodes" {
  name               = "${local.name}-nodes"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "nodes" {
  for_each   = toset(["AmazonEKSWorkerNodePolicy", "AmazonEC2ContainerRegistryPullOnly"])
  role       = aws_iam_role.nodes.name
  policy_arn = "arn:aws:iam::aws:policy/${each.key}"
}
resource "aws_launch_template" "nodes" {
  name_prefix = "${local.name}-"
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 80
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }
}
# One managed group per AZ also supports zone-bound EBS volumes.
resource "aws_eks_node_group" "this" {
  for_each        = { for i, az in var.azs : az => module.vpc.private_subnet_ids[i] }
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "workers-${each.key}"
  node_role_arn   = aws_iam_role.nodes.arn
  subnet_ids      = [each.value]
  instance_types  = var.node_instance_types
  ami_type        = "AL2023_x86_64_STANDARD"
  release_version = var.node_ami_release_version
  capacity_type   = "ON_DEMAND"
  launch_template {
    id      = aws_launch_template.nodes.id
    version = aws_launch_template.nodes.latest_version
  }
  scaling_config {
    min_size     = 1
    desired_size = 1
    max_size     = var.node_max_per_az
  }
  update_config { max_unavailable = 1 }
  lifecycle { ignore_changes = [scaling_config[0].desired_size] }
  depends_on = [aws_iam_role_policy_attachment.nodes, aws_eks_addon.cni]
}
resource "aws_autoscaling_group_tag" "discovery" {
  for_each               = aws_eks_node_group.this
  autoscaling_group_name = each.value.resources[0].autoscaling_groups[0].name
  tag {
    key                 = "k8s.io/cluster-autoscaler/enabled"
    value               = "true"
    propagate_at_launch = false
  }
}
resource "aws_autoscaling_group_tag" "ownership" {
  for_each               = aws_eks_node_group.this
  autoscaling_group_name = each.value.resources[0].autoscaling_groups[0].name
  tag {
    key                 = "k8s.io/cluster-autoscaler/${local.name}"
    value               = "owned"
    propagate_at_launch = false
  }
}
resource "aws_eks_addon" "cni" {
  depends_on                  = [aws_iam_role_policy_attachment.addon]
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "vpc-cni"
  addon_version               = var.addon_versions["vpc-cni"]
  service_account_role_arn    = aws_iam_role.irsa["cni"].arn
  configuration_values        = jsonencode({ enableNetworkPolicy = "true" })
  resolve_conflicts_on_update = "PRESERVE"
}
resource "aws_eks_addon" "this" {
  for_each                    = toset(["coredns", "kube-proxy", "aws-ebs-csi-driver", "amazon-cloudwatch-observability"])
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = each.value
  addon_version               = var.addon_versions[each.value]
  service_account_role_arn    = each.value == "aws-ebs-csi-driver" ? aws_iam_role.irsa["ebs"].arn : each.value == "amazon-cloudwatch-observability" ? aws_iam_role.irsa["cloudwatch"].arn : null
  resolve_conflicts_on_update = "PRESERVE"
  depends_on                  = [aws_eks_node_group.this, aws_iam_role_policy_attachment.addon]
}
