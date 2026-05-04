# sentinel-os/infrastructure/terraform/modules/elasticache/main.tf
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }

resource "aws_elasticache_subnet_group" "sentinel" {
  name = "sentinel-${var.environment}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "sentinel" {
  replication_group_id = "sentinel-${var.environment}"
  description = "Sentinel OS Redis cluster"
  engine = "redis"
  engine_version = "7.1"
  node_type = var.environment == "prod" ? "cache.r6g.xlarge" : "cache.r6g.large"
  num_cache_clusters = var.environment == "prod" ? 3 : 1
  subnet_group_name = aws_elasticache_subnet_group.sentinel.name
  security_group_ids = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = var.environment == "prod"
}

resource "aws_security_group" "redis" {
  name = "sentinel-redis-${var.environment}"
  vpc_id = var.vpc_id
  ingress { from_port = 6379; to_port = 6379; protocol = "tcp"; cidr_blocks = ["10.0.0.0/8"] }
}

output "redis_endpoint" { value = aws_elasticache_replication_group.sentinel.primary_endpoint_address }
