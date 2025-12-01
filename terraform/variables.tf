# =============================================================================
# Deecell Fleet Tracking - Variables
# =============================================================================

# -----------------------------------------------------------------------------
# Project Configuration
# -----------------------------------------------------------------------------

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "deecell-fleet"
}

variable "environment" {
  description = "Environment (dev, staging, production)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Network Configuration
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "single_nat_gateway" {
  description = "Use single NAT gateway to reduce costs"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Application Configuration
# -----------------------------------------------------------------------------

variable "domain_name" {
  description = "Domain name for the application (e.g., fleet.deecell.com)"
  type        = string
  default     = ""
}

variable "container_port" {
  description = "Port the application container listens on"
  type        = number
  default     = 5000
}

variable "health_check_path" {
  description = "Health check endpoint path"
  type        = string
  default     = "/api/health"
}

# -----------------------------------------------------------------------------
# ECS Configuration (Web Application)
# -----------------------------------------------------------------------------

variable "ecr_repository_url" {
  description = "ECR repository URL for the application image"
  type        = string
}

variable "container_image_tag" {
  description = "Container image tag to deploy"
  type        = string
  default     = "latest"
}

variable "ecs_cpu" {
  description = "ECS task CPU units (256, 512, 1024, 2048, 4096)"
  type        = number
  default     = 512
}

variable "ecs_memory" {
  description = "ECS task memory in MB"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 2
}

variable "min_capacity" {
  description = "Minimum number of ECS tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "max_capacity" {
  description = "Maximum number of ECS tasks for auto-scaling"
  type        = number
  default     = 4
}

# -----------------------------------------------------------------------------
# Device Manager EC2 Configuration
# -----------------------------------------------------------------------------

variable "device_manager_instance_type" {
  description = "EC2 instance type for Device Manager"
  type        = string
  default     = "t3.medium"
}

variable "device_manager_ami_id" {
  description = "AMI ID for Device Manager (Amazon Linux 2023)"
  type        = string
  default     = "" # Will use latest Amazon Linux 2023 if empty
}

variable "device_manager_key_pair" {
  description = "EC2 key pair name for SSH access"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Database Configuration
# -----------------------------------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.small"
}

variable "db_allocated_storage" {
  description = "Initial database storage in GB"
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Maximum database storage in GB (for autoscaling)"
  type        = number
  default     = 100
}

variable "db_backup_retention" {
  description = "Database backup retention period in days"
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = false
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Application Secrets
# -----------------------------------------------------------------------------

variable "session_secret" {
  description = "Secret key for session encryption"
  type        = string
  sensitive   = true
}

variable "admin_password" {
  description = "Admin dashboard password (required - no default for security)"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.admin_password) >= 12
    error_message = "Admin password must be at least 12 characters long."
  }
}

variable "eia_api_key" {
  description = "EIA API key for fuel price data"
  type        = string
  sensitive   = true
  default     = ""
}

variable "openai_api_key" {
  description = "OpenAI API key for fleet assistant"
  type        = string
  sensitive   = true
  default     = ""
}

# -----------------------------------------------------------------------------
# Security & Compliance
# -----------------------------------------------------------------------------

variable "enable_deletion_protection" {
  description = "Enable deletion protection for RDS and ALB"
  type        = bool
  default     = true
}

variable "enable_cloudtrail" {
  description = "Enable CloudTrail for audit logging"
  type        = bool
  default     = true
}

variable "enable_guardduty" {
  description = "Enable GuardDuty for threat detection"
  type        = bool
  default     = true
}

variable "enable_container_insights" {
  description = "Enable CloudWatch Container Insights"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 90
}

# -----------------------------------------------------------------------------
# Alerting
# -----------------------------------------------------------------------------

variable "alert_email" {
  description = "Email address for alerts (optional)"
  type        = string
  default     = ""
}
