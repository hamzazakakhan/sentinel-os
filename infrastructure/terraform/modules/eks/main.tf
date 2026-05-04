# ──────────────────────────────────────────────────────────────
# sentinel-os/infrastructure/terraform/modules/eks/main.tf
# EKS cluster with managed node groups for Sentinel OS
# ──────────────────────────────────────────────────────────────

variable "cluster_name" { type = string; default = "sentinel-os" }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "kubernetes_version" { type = string; default = "1.29" }

resource "aws_eks_cluster" "sentinel" {
  name = "${var.cluster_name}-${var.environment}"
  role_arn = aws_iam_role.cluster.arn
  version = var.kubernetes_version

  vpc_config {
    subnet_ids = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access = var.environment == "dev"
    security_group_ids = [aws_security_group.cluster.id]
  }

  encryption_config {
    provider { key_arn = aws_kms_key.eks.arn }
    resources = ["secrets"]
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
}

resource "aws_eks_node_group" "core" {
  cluster_name = aws_eks_cluster.sentinel.name
  node_group_name = "core"
  node_role_arn = aws_iam_role.node.arn
  subnet_ids = var.private_subnet_ids

  scaling_config { min_size = 3; max_size = 10; desired_size = 3 }
  instance_types = ["m5.xlarge"]
  labels = { role = "core" }
}

resource "aws_eks_node_group" "ai" {
  cluster_name = aws_eks_cluster.sentinel.name
  node_group_name = "ai-gpu"
  node_role_arn = aws_iam_role.node.arn
  subnet_ids = var.private_subnet_ids

  scaling_config { min_size = 0; max_size = 4; desired_size = var.environment == "prod" ? 2 : 0 }
  instance_types = ["g4dn.xlarge"]
  labels = { role = "ai-gpu" }
  taint { key = "nvidia.com/gpu"; effect = "NO_SCHEDULE" }
}

resource "aws_kms_key" "eks" {
  description = "EKS encryption key for ${var.environment}"
  enable_key_rotation = true
}

resource "aws_iam_role" "cluster" {
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "eks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}

resource "aws_iam_role_policy_attachment" "cluster" {
  for_each = toset(["arn:aws:iam::aws:policy/AmazonEKSClusterPolicy", "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController"])
  role = aws_iam_role.cluster.name
  policy_arn = each.value
}

resource "aws_iam_role" "node" {
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset(["arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy", "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy", "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly", "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess"])
  role = aws_iam_role.node.name
  policy_arn = each.value
}

resource "aws_security_group" "cluster" {
  name = "sentinel-eks-${var.environment}"
  vpc_id = var.vpc_id
  ingress { from_port = 443; to_port = 443; protocol = "tcp"; cidr_blocks = ["10.0.0.0/8"] }
  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
}

output "cluster_endpoint" { value = aws_eks_cluster.sentinel.endpoint }
output "cluster_name" { value = aws_eks_cluster.sentinel.name }
output "cluster_certificate_authority" { value = aws_eks_cluster.sentinel.certificate_authority[0].data }
