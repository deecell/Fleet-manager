# =============================================================================
# Deecell Fleet Tracking - Secrets Manager Configuration
# =============================================================================

# Session Secret
resource "aws_secretsmanager_secret" "session_secret" {
  name                    = "${local.name_prefix}/session-secret-${random_id.suffix.hex}"
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
  name                    = "${local.name_prefix}/admin-password-${random_id.suffix.hex}"
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
  count                   = var.eia_api_key != "" ? 1 : 0
  name                    = "${local.name_prefix}/eia-api-key-${random_id.suffix.hex}"
  description             = "EIA API key for fuel price data"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "eia_api_key" {
  count         = var.eia_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.eia_api_key[0].id
  secret_string = var.eia_api_key
}

# OpenAI API Key (optional)
resource "aws_secretsmanager_secret" "openai_api_key" {
  count                   = var.openai_api_key != "" ? 1 : 0
  name                    = "${local.name_prefix}/openai-api-key-${random_id.suffix.hex}"
  description             = "OpenAI API key for fleet assistant"
  recovery_window_in_days = var.environment == "production" ? 7 : 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "openai_api_key" {
  count         = var.openai_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.openai_api_key[0].id
  secret_string = var.openai_api_key
}
