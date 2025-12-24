# =============================================================================
# Deecell Fleet Tracking - Main Terraform Configuration
# =============================================================================

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state configuration
  backend "s3" {
    bucket         = "deecell-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-2"
    encrypt        = true
    dynamodb_table = "deecell-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Owner       = "Deecell Power Systems"
    }
  }
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Local variables
locals {
  name_prefix   = "${var.project_name}-${var.environment}"
  account_id    = data.aws_caller_identity.current.account_id
  region        = data.aws_region.current.name
  # Deterministic unique suffix using last 8 chars of account ID
  unique_suffix = substr(local.account_id, -8, 8)

  common_tags = {
    Application = var.project_name
    Environment = var.environment
    Terraform   = "true"
  }
}
