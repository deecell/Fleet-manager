#!/bin/bash
# =============================================================================
# Device Manager - Manual AWS Deployment Script
# =============================================================================
# Usage: ./scripts/deploy-to-aws.sh [--dry-run]
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - S3 bucket created (from Terraform: device_manager_deploy_bucket_name)
#   - EC2 instances running in the ASG
#
# Environment Variables:
#   AWS_REGION           - AWS region (default: us-east-2)
#   S3_BUCKET            - S3 bucket name for deployment artifacts
#   ASG_NAME             - Auto Scaling Group name
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-us-east-2}"
S3_BUCKET="${S3_BUCKET:-}"
ASG_NAME="${ASG_NAME:-deecell-fleet-production-device-manager-asg}"
DRY_RUN=false

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true ;;
        --bucket=*) S3_BUCKET="${1#*=}" ;;
        --region=*) AWS_REGION="${1#*=}" ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Change to device-manager directory
cd "$(dirname "$0")/.."

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Device Manager AWS Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not found. Please install it first.${NC}"
    exit 1
fi

# Get S3 bucket from Terraform if not provided
if [ -z "$S3_BUCKET" ]; then
    echo -e "${YELLOW}S3_BUCKET not set, trying to get from Terraform...${NC}"
    if [ -f "../terraform/terraform.tfstate" ]; then
        S3_BUCKET=$(cd ../terraform && terraform output -raw device_manager_deploy_bucket_name 2>/dev/null || echo "")
    fi
    
    if [ -z "$S3_BUCKET" ]; then
        echo -e "${RED}Error: S3_BUCKET not set and couldn't get from Terraform.${NC}"
        echo "Set S3_BUCKET environment variable or run from Terraform directory."
        exit 1
    fi
fi

echo "Configuration:"
echo "  AWS Region: $AWS_REGION"
echo "  S3 Bucket:  $S3_BUCKET"
echo "  ASG Name:   $ASG_NAME"
echo "  Dry Run:    $DRY_RUN"
echo ""

# Create package directory
echo -e "${GREEN}Step 1: Creating deployment package...${NC}"
rm -rf package *.zip
mkdir -p package

# Copy application files
cp -r app package/
cp -r lib package/
cp -r src package/
cp -r build package/ 2>/dev/null || echo "  (no pre-built binaries)"
cp package.json package/
cp binding.gyp package/

# Create version info
COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
cat > package/version.json << EOF
{
  "version": "${COMMIT_SHA}",
  "built": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "branch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
}
EOF

# Create zip
cd package
zip -r ../device-manager-${COMMIT_SHA:0:8}.zip . -x "*.git*"
cd ..

# Also create 'latest' zip
cp device-manager-${COMMIT_SHA:0:8}.zip device-manager-latest.zip

echo "  Package created: device-manager-${COMMIT_SHA:0:8}.zip"
ls -lh device-manager-*.zip
echo ""

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}Dry run mode - skipping upload and deployment${NC}"
    exit 0
fi

# Upload to S3
echo -e "${GREEN}Step 2: Uploading to S3...${NC}"
aws s3 cp device-manager-${COMMIT_SHA:0:8}.zip \
    s3://${S3_BUCKET}/device-manager-${COMMIT_SHA:0:8}.zip \
    --region $AWS_REGION

aws s3 cp device-manager-latest.zip \
    s3://${S3_BUCKET}/device-manager-latest.zip \
    --region $AWS_REGION

echo "  Uploaded to s3://${S3_BUCKET}/"
echo ""

# Get EC2 instances
echo -e "${GREEN}Step 3: Getting EC2 instances from ASG...${NC}"
INSTANCE_IDS=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names $ASG_NAME \
    --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`].InstanceId' \
    --output text \
    --region $AWS_REGION)

if [ -z "$INSTANCE_IDS" ]; then
    echo -e "${YELLOW}No running instances found in ASG.${NC}"
    echo "  Package uploaded to S3 - will be deployed when instances start."
    exit 0
fi

echo "  Found instances: $INSTANCE_IDS"
echo ""

# Deploy to each instance
echo -e "${GREEN}Step 4: Deploying to instances via SSM...${NC}"
for INSTANCE_ID in $INSTANCE_IDS; do
    echo "  Deploying to $INSTANCE_ID..."
    
    COMMAND_ID=$(aws ssm send-command \
        --instance-ids "$INSTANCE_ID" \
        --document-name "AWS-RunShellScript" \
        --parameters 'commands=["/opt/device-manager/deploy.sh"]' \
        --timeout-seconds 300 \
        --output text \
        --query 'Command.CommandId' \
        --region $AWS_REGION)
    
    echo "    Command ID: $COMMAND_ID"
    
    # Wait for completion
    for i in {1..30}; do
        STATUS=$(aws ssm list-command-invocations \
            --command-id "$COMMAND_ID" \
            --instance-id "$INSTANCE_ID" \
            --query 'CommandInvocations[0].Status' \
            --output text \
            --region $AWS_REGION 2>/dev/null || echo "Pending")
        
        if [ "$STATUS" = "Success" ]; then
            echo -e "    ${GREEN}Success!${NC}"
            break
        elif [ "$STATUS" = "Failed" ] || [ "$STATUS" = "TimedOut" ]; then
            echo -e "    ${RED}Failed!${NC}"
            aws ssm get-command-invocation \
                --command-id "$COMMAND_ID" \
                --instance-id "$INSTANCE_ID" \
                --query 'StandardErrorContent' \
                --output text \
                --region $AWS_REGION
            exit 1
        fi
        
        sleep 5
    done
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Check CloudWatch logs for service status:"
echo "  Log Group: /ec2/deecell-fleet-production/device-manager"
echo ""

# Cleanup
rm -rf package *.zip
