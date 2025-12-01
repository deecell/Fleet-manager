# =============================================================================
# Deecell Fleet Tracking - Terraform Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# VPC Outputs
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "database_subnet_ids" {
  description = "Database subnet IDs"
  value       = aws_subnet.database[*].id
}

# -----------------------------------------------------------------------------
# ALB Outputs
# -----------------------------------------------------------------------------

output "alb_dns_name" {
  description = "ALB DNS name (use this to access the application)"
  value       = aws_lb.main.dns_name
}

output "alb_arn" {
  description = "ALB ARN"
  value       = aws_lb.main.arn
}

output "alb_zone_id" {
  description = "ALB hosted zone ID (for Route53 alias records)"
  value       = aws_lb.main.zone_id
}

# -----------------------------------------------------------------------------
# RDS Outputs
# -----------------------------------------------------------------------------

output "database_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.endpoint
}

output "database_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "database_secret_arn" {
  description = "Secrets Manager ARN for database URL"
  value       = aws_secretsmanager_secret.database_url.arn
}

# -----------------------------------------------------------------------------
# ECS Outputs
# -----------------------------------------------------------------------------

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.main.name
}

output "ecs_task_definition_arn" {
  description = "ECS task definition ARN"
  value       = aws_ecs_task_definition.main.arn
}

# -----------------------------------------------------------------------------
# Device Manager Outputs
# -----------------------------------------------------------------------------

output "device_manager_asg_name" {
  description = "Device Manager Auto Scaling Group name"
  value       = aws_autoscaling_group.device_manager.name
}

output "device_manager_launch_template_id" {
  description = "Device Manager Launch Template ID"
  value       = aws_launch_template.device_manager.id
}

# -----------------------------------------------------------------------------
# Security Outputs
# -----------------------------------------------------------------------------

output "alb_security_group_id" {
  description = "ALB security group ID"
  value       = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  description = "ECS security group ID"
  value       = aws_security_group.ecs.id
}

output "rds_security_group_id" {
  description = "RDS security group ID"
  value       = aws_security_group.rds.id
}

output "device_manager_security_group_id" {
  description = "Device Manager security group ID"
  value       = aws_security_group.device_manager.id
}

# -----------------------------------------------------------------------------
# IAM Outputs
# -----------------------------------------------------------------------------

output "github_actions_access_key_id" {
  description = "Access Key ID for GitHub Actions (store securely!)"
  value       = aws_iam_access_key.github_actions.id
  sensitive   = true
}

output "github_actions_secret_access_key" {
  description = "Secret Access Key for GitHub Actions (store securely!)"
  value       = aws_iam_access_key.github_actions.secret
  sensitive   = true
}

# -----------------------------------------------------------------------------
# SSL/TLS Outputs
# -----------------------------------------------------------------------------

output "acm_certificate_arn" {
  description = "ACM certificate ARN (if domain configured)"
  value       = var.domain_name != "" ? aws_acm_certificate.main[0].arn : null
}

output "acm_certificate_domain_validation_options" {
  description = "DNS validation records for ACM certificate"
  value       = var.domain_name != "" ? aws_acm_certificate.main[0].domain_validation_options : null
}

# -----------------------------------------------------------------------------
# S3 Outputs
# -----------------------------------------------------------------------------

output "assets_bucket_name" {
  description = "S3 bucket name for assets"
  value       = aws_s3_bucket.assets.id
}

output "alb_logs_bucket_name" {
  description = "S3 bucket name for ALB logs"
  value       = aws_s3_bucket.alb_logs.id
}

output "cloudtrail_bucket_name" {
  description = "S3 bucket name for CloudTrail logs"
  value       = var.enable_cloudtrail ? aws_s3_bucket.cloudtrail[0].id : null
}

# -----------------------------------------------------------------------------
# CloudWatch Outputs
# -----------------------------------------------------------------------------

output "ecs_log_group_name" {
  description = "CloudWatch log group for ECS"
  value       = aws_cloudwatch_log_group.ecs.name
}

output "device_manager_log_group_name" {
  description = "CloudWatch log group for Device Manager"
  value       = aws_cloudwatch_log_group.device_manager.name
}

output "cloudwatch_dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}

# -----------------------------------------------------------------------------
# Connection Strings (for reference)
# -----------------------------------------------------------------------------

output "application_url" {
  description = "Application URL"
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
}

output "health_check_url" {
  description = "Health check URL"
  value       = var.domain_name != "" ? "https://${var.domain_name}${var.health_check_path}" : "http://${aws_lb.main.dns_name}${var.health_check_path}"
}
