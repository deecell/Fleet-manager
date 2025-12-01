# =============================================================================
# Deecell Fleet Tracking - Terraform Variables
# =============================================================================
# 
# INSTRUCTIONS:
# 1. Replace YOUR_AWS_ACCOUNT_ID with your 12-digit AWS account number
#    (Find it in AWS Console top-right corner, click your name)
# 2. The passwords below should be set via environment variables for security:
#    export TF_VAR_db_password="YourDatabasePassword123!"
#    export TF_VAR_session_secret="YourSuperLongSessionSecret1234567890!"
#    export TF_VAR_admin_password="YourAdminPass123!"
#
# =============================================================================

# -----------------------------------------------------------------------------
# Project Settings (usually don't need to change)
# -----------------------------------------------------------------------------

project_name = "deecell-fleet"
environment  = "production"
aws_region   = "us-east-1"

# -----------------------------------------------------------------------------
# ECR Repository URL
# -----------------------------------------------------------------------------
# Replace YOUR_AWS_ACCOUNT_ID with your 12-digit account number
# Example: 123456789012

ecr_repository_url = "YOUR_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/deecell-fleet"

# -----------------------------------------------------------------------------
# Network Settings (defaults are fine)
# -----------------------------------------------------------------------------

vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]
single_nat_gateway = true  # Set to false for high availability (costs more)

# -----------------------------------------------------------------------------
# Web Application (ECS Fargate)
# -----------------------------------------------------------------------------

container_port    = 5000
container_image_tag = "latest"
ecs_cpu           = 512    # 0.5 vCPU
ecs_memory        = 1024   # 1 GB RAM
desired_count     = 2      # Number of containers running
min_capacity      = 1      # Minimum during low traffic
max_capacity      = 4      # Maximum during high traffic

# -----------------------------------------------------------------------------
# Database (RDS PostgreSQL)
# -----------------------------------------------------------------------------

db_instance_class       = "db.t3.small"   # ~$25/month
db_allocated_storage    = 20              # 20 GB initial
db_max_allocated_storage = 100            # Auto-scales up to 100 GB
db_backup_retention     = 7               # Keep backups for 7 days
db_multi_az             = false           # Set true for production HA (costs 2x)

# -----------------------------------------------------------------------------
# Device Manager (EC2)
# -----------------------------------------------------------------------------

device_manager_instance_type = "t3.medium"  # 2 vCPU, 4 GB RAM
device_manager_key_pair      = ""           # Leave empty unless you need SSH

# -----------------------------------------------------------------------------
# Domain (Optional - leave empty if not using custom domain yet)
# -----------------------------------------------------------------------------

domain_name      = ""
health_check_path = "/api/health"

# -----------------------------------------------------------------------------
# Security & Compliance
# -----------------------------------------------------------------------------

enable_deletion_protection = true   # Prevents accidental deletion
enable_cloudtrail          = true   # Audit logging (SOC2/ISO27001)
enable_guardduty           = true   # Threat detection
enable_container_insights  = true   # Detailed container metrics
log_retention_days         = 90     # Keep logs for 90 days

# -----------------------------------------------------------------------------
# Alerts (Optional)
# -----------------------------------------------------------------------------

alert_email = ""  # Add your email to receive alerts

# -----------------------------------------------------------------------------
# API Keys (Optional - set via environment variables)
# -----------------------------------------------------------------------------
# export TF_VAR_eia_api_key="your-eia-key"
# export TF_VAR_openai_api_key="your-openai-key"

eia_api_key    = ""
openai_api_key = ""
