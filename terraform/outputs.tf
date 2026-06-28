output "ec2_public_ip" {
  description = "The public IP of the EC2 backend instance."
  value       = aws_instance.backend.public_ip
}

output "s3_bucket_name" {
  description = "The name of the S3 artifacts bucket."
  value       = aws_s3_bucket.artifacts.bucket
}

output "rds_endpoint" {
  description = "The endpoint of the RDS Aurora PostgreSQL cluster."
  value       = aws_rds_cluster.postgres.endpoint
}
