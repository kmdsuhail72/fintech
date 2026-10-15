resource "aws_iam_openid_connect_provider" "cluster" {
  url            = aws_eks_cluster.this.identity[0].oidc[0].issuer
  client_id_list = ["sts.amazonaws.com"]
}
locals {
  oidc_host = replace(aws_iam_openid_connect_provider.cluster.url, "https://", "")
  service_accounts = {
    cni           = ["system:serviceaccount:kube-system:aws-node"]
    ebs           = ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
    cloudwatch    = ["system:serviceaccount:amazon-cloudwatch:cloudwatch-agent", "system:serviceaccount:amazon-cloudwatch:fluent-bit"]
    load-balancer = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    autoscaler    = ["system:serviceaccount:kube-system:cluster-autoscaler"]
    secrets       = ["system:serviceaccount:${local.namespace}:secrets-reader"]
    api           = ["system:serviceaccount:${local.namespace}:api"]
    ai            = ["system:serviceaccount:${local.namespace}:ai-service"]
  }
}
resource "aws_iam_role" "irsa" {
  for_each = local.service_accounts
  name     = "${local.name}-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Federated = aws_iam_openid_connect_provider.cluster.arn },
    Action = "sts:AssumeRoleWithWebIdentity",
    Condition = { StringEquals = {
      "${local.oidc_host}:aud" = "sts.amazonaws.com",
      "${local.oidc_host}:sub" = each.value
    } }
  }] })
}
resource "aws_iam_role_policy_attachment" "addon" {
  for_each   = { cni = "AmazonEKS_CNI_Policy", ebs = "service-role/AmazonEBSCSIDriverPolicy", cloudwatch = "CloudWatchAgentServerPolicy" }
  role       = aws_iam_role.irsa[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/${each.value}"
}
resource "aws_iam_policy" "load_balancer" {
  name   = "${local.name}-load-balancer-controller"
  policy = file("${path.module}/${var.load_balancer_policy_file}")
}
resource "aws_iam_role_policy_attachment" "load_balancer" {
  role       = aws_iam_role.irsa["load-balancer"].name
  policy_arn = aws_iam_policy.load_balancer.arn
}
resource "aws_iam_role_policy" "autoscaler" {
  role = aws_iam_role.irsa["autoscaler"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["autoscaling:DescribeAutoScalingGroups", "autoscaling:DescribeAutoScalingInstances", "autoscaling:DescribeLaunchConfigurations", "autoscaling:DescribeScalingActivities", "autoscaling:DescribeTags", "ec2:DescribeImages", "ec2:DescribeInstanceTypes", "ec2:DescribeLaunchTemplateVersions", "ec2:GetInstanceTypesFromInstanceRequirements", "eks:DescribeNodegroup"], Resource = "*"
    }, {
    Effect    = "Allow", Action = ["autoscaling:SetDesiredCapacity", "autoscaling:TerminateInstanceInAutoScalingGroup"], Resource = "*",
    Condition = { StringEquals = { "aws:ResourceTag/k8s.io/cluster-autoscaler/enabled" = "true", "aws:ResourceTag/k8s.io/cluster-autoscaler/${local.name}" = "owned" } }
  }] })
}
resource "aws_iam_role_policy" "secrets" {
  role = aws_iam_role.irsa["secrets"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"], Resource = values(module.secrets.arns)
  }] })
}
resource "aws_iam_role_policy" "objects" {
  for_each = toset(["api", "ai"])
  role     = aws_iam_role.irsa[each.value].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${module.objects.arn}/${each.value}/*"
    }, {
    Effect    = "Allow", Action = ["s3:ListBucket"], Resource = module.objects.arn,
    Condition = { StringLike = { "s3:prefix" = ["${each.value}/*"] } }
  }] })
}
# Application currently uses SMTP; create SMTP credentials out of band from
# this scoped IAM user, then populate the SMTP secret. No access keys in state.
resource "aws_iam_user" "ses_smtp" { name = "${local.name}-ses-smtp" }
resource "aws_iam_user_policy" "ses_smtp" {
  user = aws_iam_user.ses_smtp.name
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Action = ["ses:SendRawEmail"], Resource = "arn:aws:ses:${var.region}:${var.account_id}:identity/${var.ses_domain}",
    Condition = { StringEquals = { "ses:FromAddress" = var.ses_from_address } }
  }] })
}
