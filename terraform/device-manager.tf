# =============================================================================
# Deecell Fleet Tracking - Device Manager EC2 Configuration
# =============================================================================

# Latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# CloudWatch Log Group for Device Manager
resource "aws_cloudwatch_log_group" "device_manager" {
  name              = "/ec2/${local.name_prefix}/device-manager"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

# Device Manager User Data Script
locals {
  device_manager_user_data = <<-EOF
    #!/bin/bash
    set -e

    # Update system
    dnf update -y

    # Install Node.js 20
    dnf install -y nodejs20 npm git gcc-c++ make

    # Install CloudWatch Agent
    dnf install -y amazon-cloudwatch-agent

    # Create application directory
    mkdir -p /opt/device-manager
    cd /opt/device-manager

    # Clone the repository (or copy from S3)
    # For now, we'll create placeholder - in production, pull from ECR or S3
    cat > /opt/device-manager/package.json << 'PKGJSON'
    {
      "name": "deecell-device-manager",
      "version": "1.0.0",
      "type": "module",
      "scripts": {
        "start": "node app/index.js"
      },
      "dependencies": {
        "pg": "^8.11.3"
      }
    }
    PKGJSON

    # Create systemd service
    cat > /etc/systemd/system/device-manager.service << 'SYSTEMD'
    [Unit]
    Description=Deecell Device Manager
    After=network.target

    [Service]
    Type=simple
    User=ec2-user
    WorkingDirectory=/opt/device-manager
    ExecStart=/usr/bin/node app/index.js
    Restart=always
    RestartSec=10
    StandardOutput=journal
    StandardError=journal
    Environment=NODE_ENV=production
    Environment=LOG_LEVEL=info
    Environment=DM_PORT=3001
    Environment=POLL_INTERVAL_MS=10000
    Environment=COHORT_COUNT=10
    Environment=MAX_BATCH_SIZE=500

    [Install]
    WantedBy=multi-user.target
    SYSTEMD

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
    chown -R ec2-user:ec2-user /opt/device-manager

    # Start CloudWatch Agent
    systemctl enable amazon-cloudwatch-agent
    systemctl start amazon-cloudwatch-agent

    # Note: Device Manager won't start until the code is deployed
    # Enable the service but don't start yet
    systemctl enable device-manager
  EOF
}

# Device Manager Launch Template
resource "aws_launch_template" "device_manager" {
  name_prefix   = "${local.name_prefix}-device-manager-"
  image_id      = var.device_manager_ami_id != "" ? var.device_manager_ami_id : data.aws_ami.amazon_linux_2023.id
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
