terraform {
  backend "s3" {}
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region     = var.aws_region
  access_key = var.aws_access_key
  secret_key = var.aws_secret_key
}

# --- AWS Network Infrastructure (VPC) ---
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name    = "${var.project_name}-vpc"
    Project = var.project_name
  }
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name    = "${var.project_name}-igw"
    Project = var.project_name
  }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name    = "${var.project_name}-public-subnet-a"
    Project = var.project_name
  }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name    = "${var.project_name}-public-subnet-b"
    Project = var.project_name
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }

  tags = {
    Name    = "${var.project_name}-public-rt"
    Project = var.project_name
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

# --- AWS S3 Artifact Bucket ---
resource "random_id" "bucket_id" {
  byte_length = 4
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${var.project_name}-artifacts-${random_id.bucket_id.hex}"

  tags = {
    Project = var.project_name
  }
}

# --- AWS Security Groups ---
# Security Group for EC2 Backend
resource "aws_security_group" "backend_sg" {
  name        = "${var.project_name}-backend-sg"
  description = "Security group for backend EC2 instance"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name    = "${var.project_name}-backend-sg"
    Project = var.project_name
  }
}

resource "aws_security_group_rule" "backend_ingress_ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  security_group_id = aws_security_group.backend_sg.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "backend_ingress_http" {
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  security_group_id = aws_security_group.backend_sg.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "backend_ingress_https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.backend_sg.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "backend_ingress_api" {
  type              = "ingress"
  from_port         = 3000
  to_port           = 3000
  protocol          = "tcp"
  security_group_id = aws_security_group.backend_sg.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "backend_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.backend_sg.id
  cidr_blocks       = ["0.0.0.0/0"]
}

# Security Group for RDS to allow traffic ONLY from the backend SG
resource "aws_security_group" "rds_sg" {
  name        = "${var.project_name}-rds-sg"
  description = "Allow inbound PostgreSQL traffic from backend EC2"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name    = "${var.project_name}-rds-sg"
    Project = var.project_name
  }
}

resource "aws_security_group_rule" "rds_ingress" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds_sg.id
  source_security_group_id = aws_security_group.backend_sg.id
}

# --- AWS RDS Aurora PostgreSQL Database ---
resource "aws_db_subnet_group" "db_subnet_group" {
  name       = "${var.project_name}-db-subnet-group"
  subnet_ids = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  tags = {
    Name    = "${var.project_name}-db-subnet-group"
    Project = var.project_name
  }
}

resource "aws_rds_cluster" "postgres" {
  cluster_identifier     = "${var.project_name}-db-cluster"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned"
  engine_version         = "16.4"
  database_name          = "mnemosyne"
  master_username        = "mnemosyne"
  master_password        = "Mnemosyne2026"
  db_subnet_group_name   = aws_db_subnet_group.db_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  skip_final_snapshot    = true

  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 4
  }

  tags = {
    Project = var.project_name
  }
}

resource "aws_rds_cluster_instance" "postgres_instance" {
  identifier         = "${var.project_name}-db-instance"
  cluster_identifier = aws_rds_cluster.postgres.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.postgres.engine
  engine_version     = aws_rds_cluster.postgres.engine_version

  tags = {
    Project = var.project_name
  }
}

# --- AWS EC2 Compute Instance ---
# SSH Key Pair
resource "aws_key_pair" "backend_key" {
  key_name   = "${var.project_name}-key-v2"
  public_key = file("${path.module}/id_rsa.pem.pub")
}

# Ubuntu AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  owners = ["099720109477"] # Canonical
}

# Compute Instance
resource "aws_instance" "backend" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.backend_sg.id]
  key_name               = aws_key_pair.backend_key.key_name

  tags = {
    Name    = "${var.project_name}-backend"
    Project = var.project_name
  }
}

# --- Generate .env file for Ansible ---
resource "local_file" "env_file" {
  filename = "${path.module}/../.env"
  content  = <<-EOT
NODE_ENV=production
AWS_REGION=${var.aws_region}
AWS_ACCESS_KEY_ID=${var.aws_access_key}
AWS_SECRET_ACCESS_KEY=${var.aws_secret_key}
QWEN_API_KEY=${var.qwen_api_key}

S3_BUCKET_NAME=${aws_s3_bucket.artifacts.bucket}
DATABASE_URL=postgres://${aws_rds_cluster.postgres.master_username}:${aws_rds_cluster.postgres.master_password}@${aws_rds_cluster.postgres.endpoint}:${aws_rds_cluster.postgres.port}/${aws_rds_cluster.postgres.database_name}
REDIS_URL=redis://redis:6379

VIRTUAL_HOST=api.clestiq.com
LETSENCRYPT_HOST=api.clestiq.com
EOT
}
