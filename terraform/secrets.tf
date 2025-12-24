# =============================================================================
# Deecell Fleet Tracking - Secrets Manager Configuration
# =============================================================================

# Session Secret
resource "aws_secretsmanager_secret" "session_secret" {
  name                    = "${local.name_prefix}/session-secret-${local.unique_suffix}"
  description             = "Session encryption secret for ${local.name_prefix}"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "session_secret" {
  secret_id     = aws_secretsmanager_secret.session_secret.id
  secret_string = var.session_secret
}

# Admin Password
resource "aws_secretsmanager_secret" "admin_password" {
  name                    = "${local.name_prefix}/admin-password-${local.unique_suffix}"
  description             = "Admin dashboard password for ${local.name_prefix}"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "admin_password" {
  secret_id     = aws_secretsmanager_secret.admin_password.id
  secret_string = var.admin_password
}

# EIA API Key (optional)
resource "aws_secretsmanager_secret" "eia_api_key" {
  count                   = var.enable_eia ? 1 : 0
  name                    = "${local.name_prefix}/eia-api-key-${local.unique_suffix}"
  description             = "EIA API key for fuel price data"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "eia_api_key" {
  count         = var.enable_eia ? 1 : 0
  secret_id     = aws_secretsmanager_secret.eia_api_key[0].id
  secret_string = var.eia_api_key
}

# OpenAI API Key (optional)
resource "aws_secretsmanager_secret" "openai_api_key" {
  count                   = var.enable_openai ? 1 : 0
  name                    = "${local.name_prefix}/openai-api-key-${local.unique_suffix}"
  description             = "OpenAI API key for fleet assistant"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "openai_api_key" {
  count         = var.enable_openai ? 1 : 0
  secret_id     = aws_secretsmanager_secret.openai_api_key[0].id
  secret_string = var.openai_api_key
}

# SendGrid API Key (optional)
resource "aws_secretsmanager_secret" "sendgrid_api_key" {
  count                   = var.enable_sendgrid ? 1 : 0
  name                    = "${local.name_prefix}/sendgrid-api-key-${local.unique_suffix}"
  description             = "SendGrid API key for email notifications"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "sendgrid_api_key" {
  count         = var.enable_sendgrid ? 1 : 0
  secret_id     = aws_secretsmanager_secret.sendgrid_api_key[0].id
  secret_string = var.sendgrid_api_key
}

# SIMPro API Client (optional - for SIM location tracking)
resource "aws_secretsmanager_secret" "simpro_api_client" {
  count                   = var.enable_simpro ? 1 : 0
  name                    = "${local.name_prefix}/simpro-api-client-${local.unique_suffix}"
  description             = "SIMPro API client ID for SIM location tracking"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "simpro_api_client" {
  count         = var.enable_simpro ? 1 : 0
  secret_id     = aws_secretsmanager_secret.simpro_api_client[0].id
  secret_string = var.simpro_api_client
}

# SIMPro API Key (optional - for SIM location tracking)
resource "aws_secretsmanager_secret" "simpro_api_key" {
  count                   = var.enable_simpro ? 1 : 0
  name                    = "${local.name_prefix}/simpro-api-key-${local.unique_suffix}"
  description             = "SIMPro API key for SIM location tracking"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "simpro_api_key" {
  count         = var.enable_simpro ? 1 : 0
  secret_id     = aws_secretsmanager_secret.simpro_api_key[0].id
  secret_string = var.simpro_api_key
}
