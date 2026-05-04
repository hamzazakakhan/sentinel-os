# ──────────────────────────────────────────────────────────────
# sentinel-os/infrastructure/terraform/modules/vpc/main.tf
# VPC module: public/private/isolated subnets, NAT, flow logs
# ──────────────────────────────────────────────────────────────

variable "cidr" { type = string; default = "10.0.0.0/16" }
variable "environment" { type = string }
variable "region" { type = string; default = "us-east-1" }
variable "availability_zones" { type = list(string); default = ["us-east-1a", "us-east-1b", "us-east-1c"] }

resource "aws_vpc" "sentinel" {
  cidr_block = var.cidr
  enable_dns_hostnames = true
  enable_dns_support = true
  tags = { Name = "sentinel-${var.environment}-vpc", Environment = var.environment }
}

resource "aws_internet_gateway" "sentinel" {
  vpc_id = aws_vpc.sentinel.id
  tags = { Name = "sentinel-${var.environment}-igw" }
}

resource "aws_subnet" "public" {
  count = length(var.availability_zones)
  vpc_id = aws_vpc.sentinel.id
  cidr_block = cidrsubnet(var.cidr, 8, count.index)
  availability_zone = var.availability_zones[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "sentinel-${var.environment}-public-${count.index}", Tier = "public" }
}

resource "aws_subnet" "private" {
  count = length(var.availability_zones)
  vpc_id = aws_vpc.sentinel.id
  cidr_block = cidrsubnet(var.cidr, 8, count.index + 10)
  availability_zone = var.availability_zones[count.index]
  tags = { Name = "sentinel-${var.environment}-private-${count.index}", Tier = "private" }
}

resource "aws_subnet" "isolated" {
  count = length(var.availability_zones)
  vpc_id = aws_vpc.sentinel.id
  cidr_block = cidrsubnet(var.cidr, 8, count.index + 20)
  availability_zone = var.availability_zones[count.index]
  tags = { Name = "sentinel-${var.environment}-isolated-${count.index}", Tier = "isolated" }
}

resource "aws_nat_gateway" "sentinel" {
  count = length(var.availability_zones)
  allocation_id = aws_eip.nat[count.index].id
  subnet_id = aws_subnet.public[count.index].id
  tags = { Name = "sentinel-${var.environment}-nat-${count.index}" }
}

resource "aws_eip" "nat" {
  count = length(var.availability_zones)
  domain = "vpc"
}

resource "aws_flow_log" "sentinel" {
  vpc_id = aws_vpc.sentinel.id
  traffic_type = "ALL"
  destination_type = "cloud-watch-logs"
  log_destination = aws_cloudwatch_log_group.vpc_flow.arn
  iam_role_arn = aws_iam_role.flow_log.arn
}

resource "aws_cloudwatch_log_group" "vpc_flow" {
  name = "/aws/vpc/sentinel-${var.environment}-flow"
  retention_in_days = 90
}

resource "aws_iam_role" "flow_log" {
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "vpc-flow-logs.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}

resource "aws_iam_role_policy" "flow_log" {
  role = aws_iam_role.flow_log.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = "*" }] })
}

output "vpc_id" { value = aws_vpc.sentinel.id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "isolated_subnet_ids" { value = aws_subnet.isolated[*].id }
