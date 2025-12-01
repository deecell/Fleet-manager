#!/bin/bash
# =============================================================================
# Deploy Deecell Fleet to AWS ECS using AWS CloudShell
# Run this script directly in AWS CloudShell (console.aws.amazon.com/cloudshell)
# =============================================================================

set -e

# Configuration
AWS_REGION="us-east-2"
ECR_REGISTRY="892213647605.dkr.ecr.us-east-2.amazonaws.com"
ECR_REPOSITORY="deecell-fleet"
ECS_CLUSTER="deecell-fleet-production-cluster"
ECS_SERVICE="deecell-fleet"
IMAGE_TAG="latest"

echo "🚀 Deecell Fleet Deployment Script"
echo "=================================="

# Step 1: Clone the repository
echo ""
echo "📥 Step 1: Cloning repository..."
if [ -d "deecell-fleet" ]; then
  cd deecell-fleet
  git pull origin main
else
  # Replace with your actual repo URL
  git clone https://github.com/YOUR_ORG/deecell-fleet.git
  cd deecell-fleet
fi

# Step 2: Login to ECR
echo ""
echo "🔐 Step 2: Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY

# Step 3: Build Docker image
echo ""
echo "🔨 Step 3: Building Docker image..."
docker build -t $ECR_REPOSITORY:$IMAGE_TAG .

# Step 4: Tag image for ECR
echo ""
echo "🏷️  Step 4: Tagging image..."
docker tag $ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

# Step 5: Push to ECR
echo ""
echo "📤 Step 5: Pushing to ECR..."
docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

# Step 6: Force new deployment
echo ""
echo "🔄 Step 6: Deploying to ECS..."
aws ecs update-service \
  --cluster $ECS_CLUSTER \
  --service $ECS_SERVICE \
  --force-new-deployment \
  --region $AWS_REGION

echo ""
echo "✅ Deployment initiated!"
echo ""
echo "Monitor deployment progress:"
echo "  aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --region $AWS_REGION"
echo ""
echo "Application URL:"
echo "  http://deecell-fleet-production-alb-5549888.us-east-2.elb.amazonaws.com"
