variable "aws_region" {
  description = "The AWS region to deploy the database in."
  default     = "us-east-1"
}

variable "aws_access_key" {
  description = "AWS Access Key ID"
  type        = string
  sensitive   = true
}

variable "aws_secret_key" {
  description = "AWS Secret Access Key"
  type        = string
  sensitive   = true
}

variable "qwen_api_key" {
  description = "Qwen Cloud API Key for the backend service"
  type        = string
  sensitive   = true
}

variable "instance_type" {
  description = "The EC2 instance type."
  default     = "t3.micro"
}

variable "project_name" {
  description = "Project name used for tagging resources."
  default     = "mnemosyne"
}
