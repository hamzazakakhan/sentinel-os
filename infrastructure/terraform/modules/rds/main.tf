# ──────────────────────────────────────────────────────────────
# sentinel-os/infrastructure/terraform/modules/rds/main.tf
# RDS PostgreSQL + PostGIS + TimescaleDB
# ──────────────────────────────────────────────────────────────

variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "db_password" { type = string; sensitive = true }

resource "aws_db_subnet_group" "sentinel" {
  name = "sentinel-${var.environment}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "rds" {
  name = "sentinel-rds-${var.environment}"
  vpc_id = var.vpc_id
  ingress { from_port = 5432; to_port = 5432; protocol = "tcp"; cidr_blocks = ["10.0.0.0/8"] }
  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
}

resource "aws_db_parameter_group" "sentinel" {
  name = "sentinel-pg16-${var.environment}"
  family = "postgres16"
  parameter { name = "shared_preload_libraries"; value = "timescaledb,pg_stat_statements" }
  parameter { name = "log_connections"; value = "1" }
  parameter { name = "log_disconnections"; value = "1" }
  parameter { name = "log_duration"; value = "0" }
  parameter { name = "log_statement"; value = "ddl" }
}

resource "aws_rds_cluster" "sentinel" {
  cluster_identifier = "sentinel-${var.environment}"
  engine = "aurora-postgresql"
  engine_version = "16.1"
  database_name = "sentinel"
  master_username = "sentinel_admin"
  master_password = var.db_password
  db_subnet_group_name = aws_db_subnet_group.sentinel.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  storage_encrypted = true
  deletion_protection = var.environment == "prod"
  skip_final_snapshot = var.environment != "prod"
  backup_retention_period = var.environment == "prod" ? 30 : 7
  preferred_backup_window = "03:00-04:00"
}

resource "aws_rds_cluster_instance" "sentinel" {
  count = var.environment == "prod" ? 2 : 1
  cluster_identifier = aws_rds_cluster.sentinel.id
  instance_class = var.environment == "prod" ? "db.r6g.xlarge" : "db.r6g.large"
  engine = "aurora-postgresql"
  engine_version = "16.1"
}

output "cluster_endpoint" { value = aws_rds_cluster.sentinel.endpoint }
output "cluster_port" { value = aws_rds_cluster.sentinel.port }
output "cluster_arn" { value = aws_rds_cluster.sentinel.arn }
