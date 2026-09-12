# =============================================================================
# Deecell Fleet Tracking - Device Manager EC2 Configuration
# =============================================================================

# Local variables for SIMPro secrets (safe references that work when count=0)
locals {
  simpro_client_arn = try(aws_secretsmanager_secret.simpro_api_client[0].arn, "")
  simpro_key_arn    = try(aws_secretsmanager_secret.simpro_api_key[0].arn, "")
  inhand_username_arn = try(data.aws_secretsmanager_secret.inhand_api_username.arn, "")
  inhand_password_arn = try(data.aws_secretsmanager_secret.inhand_api_password.arn, "")
  alerts_topic_arn     = var.alert_email != "" ? aws_sns_topic.alerts[0].arn : ""
}

# InHand Networks API credentials — created out-of-band via AWS Console/CLI
# (see scripts/migrations/2026-05-08_wire_inhand_creds_into_device_manager.sh).
# Referenced via data sources so Terraform doesn't try to manage their lifecycle
# but can still grant the device-manager role access by ARN.
data "aws_secretsmanager_secret" "inhand_api_username" {
  name = "deecell-fleet-production/inhand-api-username"
}

data "aws_secretsmanager_secret" "inhand_api_password" {
  name = "deecell-fleet-production/inhand-api-password"
}

# Ubuntu 24.04 LTS AMI (has glibc 2.38+ required for PowerMon native addon)
data "aws_ami" "ubuntu_2404" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# CloudWatch Log Group for Device Manager
resource "aws_cloudwatch_log_group" "device_manager" {
  name              = "/ec2/${local.name_prefix}/device-manager"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

# S3 bucket for Device Manager deployment artifacts
resource "aws_s3_bucket" "device_manager_deploy" {
  bucket = "${local.name_prefix}-device-manager-deploy-${local.unique_suffix}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-device-manager-deploy"
  })
}

resource "aws_s3_bucket_versioning" "device_manager_deploy" {
  bucket = aws_s3_bucket.device_manager_deploy.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "device_manager_deploy" {
  bucket = aws_s3_bucket.device_manager_deploy.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Device Manager User Data Script - fetches secrets from Secrets Manager at runtime
locals {
  device_manager_user_data = <<-EOF
    #!/bin/bash
    set -e

    # Log everything
    exec > >(tee /var/log/user-data.log) 2>&1

    echo "Starting Device Manager setup on Ubuntu 24.04..."

    # Update system
    apt-get update -y
    apt-get upgrade -y

    # Install Node.js 20 via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs git build-essential jq unzip postgresql-client

    # Install AWS CLI v2
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
    unzip -q /tmp/awscliv2.zip -d /tmp
    /tmp/aws/install
    rm -rf /tmp/aws /tmp/awscliv2.zip

    # Install Bluetooth and D-Bus libraries (required for PowerMon native addon)
    apt-get install -y libbluetooth-dev libdbus-1-dev

    # Install CloudWatch Agent
    wget -q https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -O /tmp/amazon-cloudwatch-agent.deb
    dpkg -i /tmp/amazon-cloudwatch-agent.deb
    rm /tmp/amazon-cloudwatch-agent.deb

    # Create application directory
    mkdir -p /opt/device-manager
    cd /opt/device-manager

    # Create startup script that fetches secrets from Secrets Manager
    cat > /opt/device-manager/start.sh << 'STARTSCRIPT'
    #!/bin/bash
    set -e
    
    # Fetch DATABASE_URL from Secrets Manager using IAM role
    export DATABASE_URL=$(aws secretsmanager get-secret-value \
      --secret-id "${aws_secretsmanager_secret.database_url.arn}" \
      --query 'SecretString' \
      --output text \
      --region ${var.aws_region})

    # Persist DATABASE_URL for health-check.sh to reuse, so its data-freshness
    # check follows whatever DB this instance is actually configured against.
    echo "export DATABASE_URL=\"$DATABASE_URL\"" > /opt/device-manager/.runtime-env
    chmod 600 /opt/device-manager/.runtime-env

    # Fetch SIMPro credentials if enabled
    %{if var.enable_simpro~}
    export SIMPRO_API_CLIENT=$(aws secretsmanager get-secret-value \
      --secret-id "${local.simpro_client_arn}" \
      --query 'SecretString' \
      --output text \
      --region ${var.aws_region})
    export SIMPRO_API_KEY=$(aws secretsmanager get-secret-value \
      --secret-id "${local.simpro_key_arn}" \
      --query 'SecretString' \
      --output text \
      --region ${var.aws_region})
    %{endif~}

    # Fetch InHand Networks API credentials (for GPS + router signal polling)
    export INHAND_API_USERNAME=$(aws secretsmanager get-secret-value \
      --secret-id "${local.inhand_username_arn}" \
      --query 'SecretString' \
      --output text \
      --region ${var.aws_region})
    export INHAND_API_PASSWORD=$(aws secretsmanager get-secret-value \
      --secret-id "${local.inhand_password_arn}" \
      --query 'SecretString' \
      --output text \
      --region ${var.aws_region})
    export INHAND_API_BASE_URL=https://na.inhandcloud.com

    # Set other environment variables
    export NODE_ENV=production
    export LOG_LEVEL=info
    export DM_PORT=3001
    export POLL_INTERVAL_MS=10000
    export COHORT_COUNT=10
    export MAX_BATCH_SIZE=500
    
    # Start the application
    exec node app/index.js
    STARTSCRIPT
    
    chmod +x /opt/device-manager/start.sh

    # Download AWS RDS CA certificate bundle for secure SSL connections
    mkdir -p /opt/device-manager/certs
    curl -sS "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" -o /opt/device-manager/certs/rds-ca-bundle.pem
    chmod 644 /opt/device-manager/certs/rds-ca-bundle.pem
    chown ubuntu:ubuntu /opt/device-manager/certs/rds-ca-bundle.pem

    # Create systemd service that uses the startup script
    cat > /etc/systemd/system/device-manager.service << 'SYSTEMD'
    [Unit]
    Description=Deecell Device Manager
    After=network.target

    [Service]
    Type=simple
    User=ubuntu
    WorkingDirectory=/opt/device-manager
    Environment=RDS_CA_BUNDLE=/opt/device-manager/certs/rds-ca-bundle.pem
    ExecStart=/opt/device-manager/start.sh
    Restart=always
    RestartSec=10
    StandardOutput=journal
    StandardError=journal

    [Install]
    WantedBy=multi-user.target
    SYSTEMD

    # Create deployment script that fetches code from S3
    cat > /opt/device-manager/deploy.sh << 'DEPLOYSCRIPT'
    #!/bin/bash
    set -e
    
    BUCKET="${aws_s3_bucket.device_manager_deploy.bucket}"
    ARTIFACT="device-manager-latest.zip"
    
    echo "Fetching deployment artifact from S3..."
    aws s3 cp "s3://$BUCKET/$ARTIFACT" /tmp/device-manager.zip --region ${var.aws_region}
    
    echo "Extracting artifact..."
    cd /opt/device-manager
    unzip -o /tmp/device-manager.zip
    
    echo "Installing dependencies..."
    npm ci --only=production
    
    echo "Building native addon for this platform..."
    npm rebuild

    echo "Verifying native addon..."
    if [ ! -f build/Release/powermon_addon.node ]; then
      echo "ERROR: native addon build failed - build/Release/powermon_addon.node not found" >&2
      exit 1
    fi

    echo "Restarting service..."
    RESTART_TS=$(date -u '+%Y-%m-%d %H:%M:%S')
    sudo systemctl restart device-manager

    echo "Waiting for device-manager to finish startup..."
    READY=false
    LOG=""
    for i in $(seq 1 30); do
      LOG=$(sudo journalctl -u device-manager --since "$RESTART_TS UTC" --no-pager 2>/dev/null)
      if echo "$LOG" | grep -q "Supervisor: Failed to start"; then
        echo "ERROR: device-manager failed to start" >&2
        echo "$LOG" | tail -n 40 >&2
        exit 1
      fi
      if echo "$LOG" | grep -q "Supervisor: All services started"; then
        echo "device-manager started successfully (Supervisor: All services started)"
        READY=true
        break
      fi
      sleep 2
    done

    if [ "$READY" != "true" ]; then
      echo "ERROR: device-manager did not log startup completion within 60s" >&2
      sudo systemctl status device-manager --no-pager || true
      echo "$LOG" | tail -n 40 >&2
      exit 1
    fi

    if ! systemctl is-active --quiet device-manager; then
      echo "ERROR: startup logged success but service is not active" >&2
      exit 1
    fi

    echo "Deployment complete!"
    DEPLOYSCRIPT
    
    chmod +x /opt/device-manager/deploy.sh

    # Create health-check script that publishes service status + data
    # freshness to CloudWatch, and sends a rich SNS alert on state transitions
    cat > /opt/device-manager/health-check.sh << 'HEALTHCHECK'
    #!/bin/bash

    REGION="${var.aws_region}"
    NAMESPACE="Deecell/DeviceManager"
    STATE_FILE="/opt/device-manager/.health-check-state"
    FRESHNESS_STATE_FILE="/opt/device-manager/.freshness-check-state"
    RUNTIME_ENV="/opt/device-manager/.runtime-env"
    SNS_TOPIC_ARN="${local.alerts_topic_arn}"
    STALE_THRESHOLD_SECONDS=300

    TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
    INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
    NOW_HUMAN=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

    # --- Process check ---
    if systemctl is-active --quiet device-manager; then
      ACTIVE_VALUE=1
      CURRENT_STATE="active"
    else
      ACTIVE_VALUE=0
      CURRENT_STATE="inactive"
    fi

    aws cloudwatch put-metric-data --region "$REGION" --namespace "$NAMESPACE" \
      --metric-name ServiceActive --value "$ACTIVE_VALUE" --unit Count 2>/dev/null || true

    # --- Data freshness check (follows whatever DB this instance is configured against) ---
    if [ -f "$RUNTIME_ENV" ]; then
      . "$RUNTIME_ENV"
    fi
    AGE_SECONDS=""
    FRESHNESS_STATE="unknown"
    if [ -n "$DATABASE_URL" ]; then
      AGE_SECONDS=$(psql "$DATABASE_URL" -tAc "SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(recorded_at))), 999999) FROM device_measurements;" 2>/dev/null | tr -d '[:space:]')
      case "$AGE_SECONDS" in
        ''|*[!0-9.]*) AGE_SECONDS=999999 ;;
      esac
      aws cloudwatch put-metric-data --region "$REGION" --namespace "$NAMESPACE" \
        --metric-name DataAgeSeconds --value "$AGE_SECONDS" --unit Seconds 2>/dev/null || true
      if awk -v a="$AGE_SECONDS" -v t="$STALE_THRESHOLD_SECONDS" 'BEGIN{exit !(a > t)}'; then
        FRESHNESS_STATE="stale"
      else
        FRESHNESS_STATE="fresh"
      fi
    fi

    # --- Rich SNS alert on service state transition only (avoid spamming every tick) ---
    PREV_STATE="unknown"
    if [ -f "$STATE_FILE" ]; then
      PREV_STATE=$(cat "$STATE_FILE")
    fi

    if [ "$CURRENT_STATE" != "$PREV_STATE" ] && [ -n "$SNS_TOPIC_ARN" ]; then
      LOGS=$(journalctl -u device-manager -n 40 --no-pager 2>/dev/null || echo "no logs available")
      if [ "$CURRENT_STATE" = "inactive" ]; then
        SUBJECT="$(printf '\xF0\x9F\x94\xB4') Device Manager Service: DOWN"
        BODY="$(printf '\xF0\x9F\x94\xB4') Device Manager Service: DOWN

    The system that monitors your trucks' PowerMon devices has stopped working. No new data is being collected right now.

    Instance: $INSTANCE_ID
    Time: $NOW_HUMAN

    ---
    Technical details (for engineers):

    device-manager.service is INACTIVE on instance $INSTANCE_ID.

    Recent systemd logs:
    $LOGS"
      else
        SUBJECT="$(printf '\xF0\x9F\x9F\xA2') Device Manager Service: RESTORED"
        BODY="$(printf '\xF0\x9F\x9F\xA2') Device Manager Service: RESTORED

    The system is back up and working normally. Data collection has resumed.

    Instance: $INSTANCE_ID
    Time: $NOW_HUMAN

    ---
    Technical details (for engineers):

    device-manager.service has RECOVERED to active on instance $INSTANCE_ID.

    Recent systemd logs:
    $LOGS"
      fi
      aws sns publish --region "$REGION" --topic-arn "$SNS_TOPIC_ARN" --subject "$SUBJECT" --message "$BODY" 2>/dev/null || true
    fi

    echo "$CURRENT_STATE" > "$STATE_FILE"

    # --- Rich SNS alert on data-freshness state transition only ---
    PREV_FRESHNESS="unknown"
    if [ -f "$FRESHNESS_STATE_FILE" ]; then
      PREV_FRESHNESS=$(cat "$FRESHNESS_STATE_FILE")
    fi

    if [ -n "$AGE_SECONDS" ] && [ "$FRESHNESS_STATE" != "$PREV_FRESHNESS" ] && [ -n "$SNS_TOPIC_ARN" ]; then
      LOGS=$(journalctl -u device-manager -n 40 --no-pager 2>/dev/null || echo "no logs available")
      AGE_MIN=$(awk -v a="$AGE_SECONDS" 'BEGIN{printf "%.1f", a/60}')
      if [ "$FRESHNESS_STATE" = "stale" ]; then
        SUBJECT="$(printf '\xF0\x9F\x94\xB4') Device Manager Data: STALE"
        BODY="$(printf '\xF0\x9F\x94\xB4') Device Manager Data: STALE

    No new truck data has been received in over 5 minutes. PowerMon device readings may not be updating.

    Instance: $INSTANCE_ID
    Time: $NOW_HUMAN
    Data age: ~$${AGE_MIN} minutes since the last reading

    ---
    Technical details (for engineers):

    MAX(device_measurements.recorded_at) age is $${AGE_SECONDS}s, exceeding the $${STALE_THRESHOLD_SECONDS}s threshold, on instance $INSTANCE_ID.

    Recent systemd logs:
    $LOGS"
      else
        SUBJECT="$(printf '\xF0\x9F\x9F\xA2') Device Manager Data: FLOWING"
        BODY="$(printf '\xF0\x9F\x9F\xA2') Device Manager Data: FLOWING

    Truck data is flowing normally again. New PowerMon device readings are being received.

    Instance: $INSTANCE_ID
    Time: $NOW_HUMAN
    Data age: $${AGE_SECONDS}s

    ---
    Technical details (for engineers):

    MAX(device_measurements.recorded_at) age is back to $${AGE_SECONDS}s (threshold: $${STALE_THRESHOLD_SECONDS}s) on instance $INSTANCE_ID.

    Recent systemd logs:
    $LOGS"
      fi
      aws sns publish --region "$REGION" --topic-arn "$SNS_TOPIC_ARN" --subject "$SUBJECT" --message "$BODY" 2>/dev/null || true
    fi

    if [ -n "$AGE_SECONDS" ]; then
      echo "$FRESHNESS_STATE" > "$FRESHNESS_STATE_FILE"
    fi
    HEALTHCHECK

    chmod +x /opt/device-manager/health-check.sh

    # Create systemd oneshot service + timer to run the health check every minute
    cat > /etc/systemd/system/device-manager-healthcheck.service << 'HCSERVICE'
    [Unit]
    Description=Device Manager Health Check

    [Service]
    Type=oneshot
    User=ubuntu
    ExecStart=/opt/device-manager/health-check.sh
    HCSERVICE

    cat > /etc/systemd/system/device-manager-healthcheck.timer << 'HCTIMER'
    [Unit]
    Description=Run Device Manager Health Check every minute

    [Timer]
    OnBootSec=30
    OnUnitActiveSec=60
    AccuracySec=5

    [Install]
    WantedBy=timers.target
    HCTIMER

    systemctl daemon-reload
    systemctl enable --now device-manager-healthcheck.timer

    # Configure CloudWatch Agent
    cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWAGENT'
    {
      "agent": {
        "metrics_collection_interval": 60,
        "run_as_user": "root"
      },
      "logs": {
        "logs_collected": {
          "files": {
            "collect_list": [
              {
                "file_path": "/var/log/messages",
                "log_group_name": "/ec2/${local.name_prefix}/device-manager",
                "log_stream_name": "{instance_id}/messages"
              },
              {
                "file_path": "/var/log/user-data.log",
                "log_group_name": "/ec2/${local.name_prefix}/device-manager",
                "log_stream_name": "{instance_id}/user-data"
              }
            ]
          }
        }
      },
      "metrics": {
        "namespace": "Deecell/DeviceManager",
        "metrics_collected": {
          "cpu": {
            "measurement": ["cpu_usage_idle", "cpu_usage_user", "cpu_usage_system"],
            "metrics_collection_interval": 60
          },
          "mem": {
            "measurement": ["mem_used_percent"],
            "metrics_collection_interval": 60
          },
          "disk": {
            "measurement": ["disk_used_percent"],
            "metrics_collection_interval": 60
          }
        }
      }
    }
    CWAGENT

    # Set ownership
    chown -R ubuntu:ubuntu /opt/device-manager

    # Start CloudWatch Agent
    systemctl enable amazon-cloudwatch-agent
    systemctl start amazon-cloudwatch-agent

    # Enable the service (will start after code is deployed via deploy.sh)
    systemctl enable device-manager

    # Run the initial deployment so the instance is fully functional as soon as
    # bootstrap finishes, instead of requiring a manual deploy.sh invocation.
    echo "Running initial deployment..."
    sudo -u ubuntu /opt/device-manager/deploy.sh

    echo "Device Manager deployment finished successfully."
  EOF
}

# Device Manager Launch Template
resource "aws_launch_template" "device_manager" {
  name_prefix   = "${local.name_prefix}-device-manager-"
  image_id      = var.device_manager_ami_id != "" ? var.device_manager_ami_id : data.aws_ami.ubuntu_2404.id
  instance_type = var.device_manager_instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.device_manager.arn
  }

  vpc_security_group_ids = [aws_security_group.device_manager.id]

  key_name = var.device_manager_key_pair != "" ? var.device_manager_key_pair : null

  user_data = base64encode(local.device_manager_user_data)

  monitoring {
    enabled = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 required for security
    http_put_response_hop_limit = 1
  }

  tag_specifications {
    resource_type = "instance"
    tags = merge(local.common_tags, {
      Name = "${local.name_prefix}-device-manager"
      Role = "DeviceManager"
    })
  }

  tag_specifications {
    resource_type = "volume"
    tags = merge(local.common_tags, {
      Name = "${local.name_prefix}-device-manager-volume"
    })
  }

  tags = local.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

# Device Manager Auto Scaling Group
resource "aws_autoscaling_group" "device_manager" {
  name                = "${local.name_prefix}-device-manager-asg"
  min_size            = 1
  max_size            = 3
  desired_capacity    = 1
  vpc_zone_identifier = aws_subnet.private[*].id

  launch_template {
    id      = aws_launch_template.device_manager.id
    version = "$Latest"
  }

  health_check_type         = "EC2"
  health_check_grace_period = 300

  enabled_metrics = [
    "GroupMinSize",
    "GroupMaxSize",
    "GroupDesiredCapacity",
    "GroupInServiceInstances",
    "GroupTotalInstances"
  ]

  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-device-manager"
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = local.common_tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

# CloudWatch Alarms for Device Manager
resource "aws_cloudwatch_metric_alarm" "device_manager_cpu" {
  alarm_name          = "${local.name_prefix}-device-manager-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Device Manager CPU utilization is too high"

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.device_manager.name
  }

  actions_enabled = var.alert_email != ""
  alarm_actions   = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []

  tags = local.common_tags
}

# Device Manager Service Health Alarms (published by health-check.sh via a
# systemd timer running on the instance - see device_manager_user_data above)
resource "aws_cloudwatch_metric_alarm" "device_manager_service_inactive" {
  alarm_name          = "${local.name_prefix}-device-manager-service-inactive"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ServiceActive"
  namespace           = "Deecell/DeviceManager"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "device-manager.service is not active (systemctl is-active reports inactive/failed)"
  treat_missing_data  = "breaching"

  actions_enabled = var.alert_email != ""
  alarm_actions   = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []
  ok_actions      = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "device_manager_data_stale" {
  alarm_name          = "${local.name_prefix}-device-manager-data-stale"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DataAgeSeconds"
  namespace           = "Deecell/DeviceManager"
  period              = 60
  statistic           = "Maximum"
  threshold           = 300
  alarm_description   = "No new device_measurements rows written in over 5 minutes"
  treat_missing_data  = "breaching"

  actions_enabled = var.alert_email != ""
  alarm_actions   = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []
  ok_actions      = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []

  tags = local.common_tags
}
