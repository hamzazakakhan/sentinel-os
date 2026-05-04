# sentinel-os/infrastructure/terraform/environments/staging/main.tf
module "vpc" { source = "../../modules/vpc"; cidr = "10.1.0.0/16"; environment = "staging"; region = "us-east-1" }
module "eks" { source = "../../modules/eks"; environment = "staging"; vpc_id = module.vpc.vpc_id; private_subnet_ids = module.vpc.private_subnet_ids }
module "rds" { source = "../../modules/rds"; environment = "staging"; vpc_id = module.vpc.vpc_id; private_subnet_ids = module.vpc.private_subnet_ids; db_password = var.db_password }
module "redis" { source = "../../modules/elasticache"; environment = "staging"; vpc_id = module.vpc.vpc_id; private_subnet_ids = module.vpc.private_subnet_ids }
module "kafka" { source = "../../modules/kafka"; environment = "staging"; vpc_id = module.vpc.vpc_id; private_subnet_ids = module.vpc.private_subnet_ids }

variable "db_password" { type = string; sensitive = true }
terraform { backend "s3" { bucket = "sentinel-os-tfstate"; key = "staging/terraform.tfstate"; region = "us-east-1"; encrypt = true } }
provider "aws" { region = "us-east-1" }
