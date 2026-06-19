output "ecs_public_ip" {
  description = "The public IP of the Alibaba Cloud ECS instance."
  value       = alicloud_instance.backend.public_ip
}

output "dynamodb_table_name" {
  description = "The name of the DynamoDB table."
  value       = aws_dynamodb_table.main_db.name
}
