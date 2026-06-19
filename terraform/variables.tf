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

variable "alicloud_region" {
  description = "The Alibaba Cloud region to deploy the ECS instance in."
  default     = "us-east-1"
}

variable "alicloud_access_key" {
  description = "Alibaba Cloud Access Key ID"
  type        = string
  sensitive   = true
}

variable "alicloud_secret_key" {
  description = "Alibaba Cloud Secret Access Key"
  type        = string
  sensitive   = true
}

variable "qwen_api_key" {
  description = "Qwen Cloud API Key for the backend service"
  type        = string
  sensitive   = true
}

variable "instance_type" {
  description = "The ECS instance type."
  default     = "ecs.t5-lc1m1.small"
}

variable "project_name" {
  description = "Project name used for tagging resources."
  default     = "mnemosyne"
}
