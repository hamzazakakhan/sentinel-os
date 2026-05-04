# sentinel-os/infrastructure/terraform/environments/dev/main.tf
module "vpc" { source = "../../modules/vpc"; cidr = "10.2.0.0/16"; environment = "dev"; region = "us-east-1"; availability_zones = ["us-east-1a"] }
module "eks" { source = "../../modules/eks"; environment = "dev"; vpc_id = module.vpc.vpc_id; private_subnet_ids = module.vpc.private_subnet_ids }
module "rds" { source = "../../modules/rds"; environment = "dev"; vpc_id = module.vpc.vpc_id; private_subnet_ids = module.vpc.private_subnet_ids; db_password = var.db_password }
module "redis" { source = "../../modules/elasticache"; environment = "dev"; vpc_id = module.vpc.vpc_id; private_subnet_ids = module.vpc.private_subnet_ids }
module "kafka" { source = "../../modules/kafka"; environment = "dev"; vpc_id = module.vpc.vpc_id; private_subnet_ids = module.vpc.private_subnet_ids }

variable "db_password" { type = string; sensitive = true; default = "dev-sentinel-password" }
terraform { backend "local" { path = "terraform.tfstate" } }
provider "aws" { region = "us-east-1" }
