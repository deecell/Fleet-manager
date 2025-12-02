# =============================================================================
# Deecell Fleet Tracking - Device Manager EC2 Configuration
# =============================================================================

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
  bucket = "${local.name_prefix}-device-manager-deploy-${random_id.suffix.hex}"

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
    apt-get install -y nodejs git build-essential jq unzip

    # Install AWS CLI v2
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
    unzip -q /tmp/awscliv2.zip -d /tmp
    /tmp/aws/install
    rm -rf /tmp/aws /tmp/awscliv2.zip

    # Install Bluetooth library (required for PowerMon native addon to load)
    apt-get install -y libbluetooth-dev

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

    # Create systemd service that uses the startup script
    cat > /etc/systemd/system/device-manager.service << 'SYSTEMD'
    [Unit]
    Description=Deecell Device Manager
    After=network.target

    [Service]
    Type=simple
    User=ubuntu
    WorkingDirectory=/opt/device-manager
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
    
    echo "Installing dependencies (preserving pre-built native addons)..."
    npm ci --only=production --ignore-scripts
    
    echo "Restarting service..."
    sudo systemctl restart device-manager
    
    echo "Deployment complete!"
    DEPLOYSCRIPT
    
    chmod +x /opt/device-manager/deploy.sh

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
    
    echo "Device Manager setup complete. Run /opt/device-manager/deploy.sh to deploy code."
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
