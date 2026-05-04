# sentinel-os/infrastructure/terraform/modules/kafka/main.tf
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }

resource "aws_msk_cluster" "sentinel" {
  cluster_name = "sentinel-${var.environment}"
  kafka_version = "3.7.0"
  number_of_broker_nodes = var.environment == "prod" ? 3 : 1

  broker_node_group_info {
    instance_type = var.environment == "prod" ? "kafka.m5.xlarge" : "kafka.t3.small"
    client_subnets = var.private_subnet_ids
    security_groups = [aws_security_group.kafka.id]
    storage_info { ebs_storage_info { volume_size = var.environment == "prod" ? 1000 : 100 } }
  }

  encryption_info {
    encryption_at_rest_kms_key_arn = aws_kms_key.kafka.arn
    encryption_in_cluster { encryption_in_transit { in_cluster = true } }
  }

  configuration_info { arn = aws_msk_configuration.sentinel.arn; revision = aws_msk_configuration.sentinel.latest_revision }

  logging_info { broker_logs { cloudwatch_logs { enabled = true; log_group = aws_cloudwatch_log_group.kafka.name } } }
}

resource "aws_msk_configuration" "sentinel" {
  kafka_versions = ["3.7.0"]
  name = "sentinel-${var.environment}"
  server_properties = <<PROPS
auto.create.topics.enable=false
default.replication.factor=${var.environment == "prod" ? 3 : 1}
min.insync.replicas=${var.environment == "prod" ? 2 : 1}
log.retention.hours=168
num.partitions=12
PROPS
}

resource "aws_security_group" "kafka" {
  name = "sentinel-kafka-${var.environment}"
  vpc_id = var.vpc_id
  ingress { from_port = 9092; to_port = 9094; protocol = "tcp"; cidr_blocks = ["10.0.0.0/8"] }
}

resource "aws_kms_key" "kafka" { enable_key_rotation = true }
resource "aws_cloudwatch_log_group" "kafka" { name = "/aws/msk/sentinel-${var.environment}"; retention_in_days = 30 }

output "bootstrap_brokers" { value = aws_msk_cluster.sentinel.bootstrap_brokers }
