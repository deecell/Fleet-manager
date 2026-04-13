#!/bin/bash
#
# Add SIMPro API credentials to ECS web app task definition
# Created: April 13, 2026
#
# This adds SIMPRO_API_CLIENT and SIMPRO_API_KEY from Secrets Manager
# to the ECS task definition so the web app's "Sync SIMs" button works.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   chmod +x scripts/migrations/2026-04-13_add_simpro_to_ecs.sh
#   ./scripts/migrations/2026-04-13_add_simpro_to_ecs.sh
#

set -e

REGION="us-east-2"
CLUSTER="deecell-fleet-production-cluster"
SERVICE="deecell-fleet"
TASK_FAMILY="deecell-fleet-production"

echo "=== Add SIMPro Credentials to ECS Web App ==="
echo ""
echo "This will:"
echo "  1. Get the current ECS task definition"
echo "  2. Add SIMPRO_API_CLIENT and SIMPRO_API_KEY secrets"
echo "  3. Register a new task definition revision"
echo "  4. Update the ECS service to use it"
echo ""

read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Step 1: Looking up SIMPro secret ARNs..."

SIMPRO_CLIENT_ARN=$(aws secretsmanager describe-secret \
    --secret-id "deecell-fleet-production/simpro-api-client" \
    --region "$REGION" \
    --query 'ARN' --output text 2>/dev/null) || true

SIMPRO_KEY_ARN=$(aws secretsmanager describe-secret \
    --secret-id "deecell-fleet-production/simpro-api-key" \
    --region "$REGION" \
    --query 'ARN' --output text 2>/dev/null) || true

if [ -z "$SIMPRO_CLIENT_ARN" ] || [ "$SIMPRO_CLIENT_ARN" = "None" ]; then
    echo "ERROR: Secret 'deecell-fleet-production/simpro-api-client' not found."
    echo "You may need to check the secret name in AWS Secrets Manager."
    echo ""
    echo "Listing matching secrets..."
    aws secretsmanager list-secrets --region "$REGION" \
        --filter Key=name,Values=simpro \
        --query 'SecretList[].{Name:Name,ARN:ARN}' --output table
    exit 1
fi

if [ -z "$SIMPRO_KEY_ARN" ] || [ "$SIMPRO_KEY_ARN" = "None" ]; then
    echo "ERROR: Secret 'deecell-fleet-production/simpro-api-key' not found."
    exit 1
fi

echo "  SIMPRO_API_CLIENT: $SIMPRO_CLIENT_ARN"
echo "  SIMPRO_API_KEY:    $SIMPRO_KEY_ARN"
echo ""

echo "Step 2: Getting current task definition..."
TASK_DEF_JSON=$(aws ecs describe-task-definition \
    --task-definition "$TASK_FAMILY" \
    --region "$REGION" \
    --query 'taskDefinition')

CURRENT_REVISION=$(echo "$TASK_DEF_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['revision'])")
echo "  Current revision: $CURRENT_REVISION"

ALREADY_HAS=$(echo "$TASK_DEF_JSON" | python3 -c "
import sys, json
td = json.load(sys.stdin)
secrets = td['containerDefinitions'][0].get('secrets', [])
names = [s['name'] for s in secrets]
print('yes' if 'SIMPRO_API_CLIENT' in names else 'no')
")

if [ "$ALREADY_HAS" = "yes" ]; then
    echo ""
    echo "SIMPro credentials are already in the task definition!"
    echo "No changes needed."
    exit 0
fi

echo ""
echo "Step 3: Creating new task definition with SIMPro secrets..."

NEW_TASK_DEF=$(echo "$TASK_DEF_JSON" | python3 -c "
import sys, json

td = json.load(sys.stdin)

td['containerDefinitions'][0].setdefault('secrets', [])
td['containerDefinitions'][0]['secrets'].extend([
    {'name': 'SIMPRO_API_CLIENT', 'valueFrom': '$SIMPRO_CLIENT_ARN'},
    {'name': 'SIMPRO_API_KEY', 'valueFrom': '$SIMPRO_KEY_ARN'}
])

keep_keys = [
    'family', 'taskRoleArn', 'executionRoleArn', 'networkMode',
    'containerDefinitions', 'volumes', 'placementConstraints',
    'requiresCompatibilities', 'cpu', 'memory', 'pidMode', 'ipcMode',
    'runtimePlatform', 'ephemeralStorage'
]
result = {k: v for k, v in td.items() if k in keep_keys and v}
print(json.dumps(result))
")

echo "$NEW_TASK_DEF" > /tmp/ecs-task-def-simpro.json

NEW_REVISION=$(aws ecs register-task-definition \
    --cli-input-json file:///tmp/ecs-task-def-simpro.json \
    --region "$REGION" \
    --query 'taskDefinition.revision' --output text)

echo "  New revision: $NEW_REVISION"
echo ""

echo "Step 4: Updating ECS service to use new revision..."
aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --task-definition "${TASK_FAMILY}:${NEW_REVISION}" \
    --region "$REGION" \
    --query 'service.taskDefinition' --output text

echo ""
echo "Done! ECS will roll out the new task definition."
echo "It typically takes 2-3 minutes for the new container to start."
echo ""
echo "You can check progress with:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $REGION --query 'services[0].deployments[*].{status:status,running:runningCount,desired:desiredCount,revision:taskDefinition}' --output table"
echo ""

rm -f /tmp/ecs-task-def-simpro.json
