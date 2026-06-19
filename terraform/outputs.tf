output "ecs_public_ip" {
  description = "The public IP of the Alibaba Cloud ECS instance."
  value       = alicloud_instance.backend.public_ip
}

output "s3_bucket_name" {
  description = "The name of the S3 artifacts bucket."
  value       = aws_s3_bucket.artifacts.bucket
}

output "rds_endpoint" {
  description = "The endpoint of the RDS PostgreSQL instance."
  value       = aws_db_instance.postgres.endpoint
}
