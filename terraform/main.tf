terraform {
  backend "s3" {}
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    alicloud = {
      source  = "aliyun/alicloud"
      version = "~> 1.200.0"
    }
  }
}

provider "aws" {
  region     = var.aws_region
  access_key = var.aws_access_key
  secret_key = var.aws_secret_key
}

provider "alicloud" {
  region     = var.alicloud_region
  access_key = var.alicloud_access_key
  secret_key = var.alicloud_secret_key
}

# --- AWS Database (DynamoDB) ---
# Simple DynamoDB table as required by the AWS Hackathon
resource "aws_dynamodb_table" "main_db" {
  name           = "${var.project_name}-table"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Project = var.project_name
  }
}

# --- Alibaba Cloud Compute (ECS) ---
# Network
resource "alicloud_vpc" "main" {
  vpc_name   = "${var.project_name}-vpc"
  cidr_block = "10.0.0.0/8"
}

data "alicloud_zones" "available" {
  available_resource_creation = "Instance"
}

resource "alicloud_vswitch" "main" {
  vswitch_name = "${var.project_name}-vswitch"
  vpc_id       = alicloud_vpc.main.id
  cidr_block   = "10.1.0.0/16"
  zone_id      = data.alicloud_zones.available.zones[0].id
}

# Security Group
resource "alicloud_security_group" "main" {
  name   = "${var.project_name}-sg"
  vpc_id = alicloud_vpc.main.id
}

# Allow SSH
resource "alicloud_security_group_rule" "allow_ssh" {
  type              = "ingress"
  ip_protocol       = "tcp"
  nic_type          = "intranet"
  policy            = "accept"
  port_range        = "22/22"
  priority          = 1
  security_group_id = alicloud_security_group.main.id
  cidr_ip           = "0.0.0.0/0"
}

# Allow HTTP
resource "alicloud_security_group_rule" "allow_http" {
  type              = "ingress"
  ip_protocol       = "tcp"
  nic_type          = "intranet"
  policy            = "accept"
  port_range        = "80/80"
  priority          = 1
  security_group_id = alicloud_security_group.main.id
  cidr_ip           = "0.0.0.0/0"
}

# Allow Backend API port (assuming 3000)
resource "alicloud_security_group_rule" "allow_api" {
  type              = "ingress"
  ip_protocol       = "tcp"
  nic_type          = "intranet"
  policy            = "accept"
  port_range        = "3000/3000"
  priority          = 1
  security_group_id = alicloud_security_group.main.id
  cidr_ip           = "0.0.0.0/0"
}

# SSH Key Pair
resource "alicloud_key_pair" "main" {
  key_pair_name = "${var.project_name}-key"
  key_file      = "${path.module}/id_rsa.pem"
}

# Compute Instance
data "alicloud_images" "ubuntu" {
  name_regex  = "^ubuntu_22_04_x64_20G_alibase"
  most_recent = true
  owners      = "system"
}

data "alicloud_instance_types" "available" {
  availability_zone = data.alicloud_zones.available.zones[0].id
  cpu_core_count    = 2
  memory_size       = 4
}

resource "alicloud_instance" "backend" {
  availability_zone = data.alicloud_zones.available.zones[0].id
  security_groups   = [alicloud_security_group.main.id]
  instance_type     = data.alicloud_instance_types.available.instance_types[0].id
  system_disk_category = "cloud_efficiency"
  system_disk_size     = 40
  image_id          = data.alicloud_images.ubuntu.images[0].id
  instance_name     = "${var.project_name}-backend"
  vswitch_id        = alicloud_vswitch.main.id
  internet_max_bandwidth_out = 10
  internet_charge_type       = "PayByTraffic"
  key_name          = alicloud_key_pair.main.key_pair_name
}

# --- Generate .env file for Ansible ---
resource "local_file" "env_file" {
  filename = "${path.module}/../.env"
  content  = <<-EOT
NODE_ENV=production
AWS_REGION=${var.aws_region}
AWS_ACCESS_KEY_ID=${var.aws_access_key}
AWS_SECRET_ACCESS_KEY=${var.aws_secret_key}
AWS_DYNAMODB_TABLE=${aws_dynamodb_table.main_db.name}
QWEN_API_KEY=${var.qwen_api_key}
EOT
}
