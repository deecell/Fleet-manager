#!/bin/bash
#
# Production ECS Task Definition Patch: add S3_BUCKET_NAME + AWS_REGION env
# Created: 2026-05-05
#
# Why: server/aws/s3.ts defaults the bucket to `deecell-fleet-files` when the
# `S3_BUCKET_NAME` env var is unset. Production never had this var wired in,
# so the export worker's S3 upload fails with "The specified bucket does not
# exist". Terraform actually created the prod bucket as
# `deecell-fleet-production-assets-<8-char-account-suffix>` and the task role
# already has read/write/list to it (terraform/iam.tf L120, L129).
#
# What this script does (and ONLY this — no other infra is touched):
#   1. Finds the prod assets bucket via `aws s3api list-buckets` (matches
#      `deecell-fleet-production-assets-*`). Bails if 0 or >1 match.
#   2. Pulls the current ECS task definition JSON.
#   3. Idempotently adds `S3_BUCKET_NAME` + `AWS_REGION` to the container's
#      `environment` array (skips with a message if already correct).
#   4. Registers a new task definition revision.
#   5. Updates the ECS service to use the new revision. The existing
#      deployment circuit breaker (rollback=true) auto-reverts on bad health.
#
# Reversible: if anything looks wrong after rollout,
#   aws ecs update-service --cluster <CLUSTER> --service <SVC> \
#     --task-definition <PREVIOUS_REVISION_ARN> --region us-east-2
#
# Idempotent: re-running with the env vars already correct is a no-op.
#
# Run from your MacBook Pro:
#   cd /Users/amoeck/Development/Fleet-manager
#   ./scripts/migrations/2026-05-05_set_ecs_s3_bucket_env.sh
#

set -e

REGION="us-east-2"
CLUSTER="deecell-fleet-production-cluster"
SERVICE="deecell-fleet"
TASK_FAMILY="deecell-fleet-production"
CONTAINER_NAME="deecell-fleet"
BUCKET_PREFIX="deecell-fleet-production-assets-"

if ! command -v aws >/dev/null 2>&1; then
    echo "Error: aws CLI is required."
    exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required."
    exit 1
fi

echo "=== Deecell Production: Wire S3_BUCKET_NAME into ECS task ==="
echo ""

# -- 1. Discover the actual prod assets bucket -------------------------------
echo "[1/5] Looking up prod assets bucket (prefix: $BUCKET_PREFIX)..."
BUCKETS=$(aws s3api list-buckets \
    --region "$REGION" \
    --query "Buckets[?starts_with(Name, \`$BUCKET_PREFIX\`)].Name" \
    --output text)

if [ -z "$BUCKETS" ]; then
    echo "Error: no bucket matching ${BUCKET_PREFIX}* found. Aborting."
    echo "       Check terraform/iam.tf 'aws_s3_bucket.assets' was applied."
    exit 1
fi

BUCKET_COUNT=$(echo "$BUCKETS" | wc -w | tr -d ' ')
if [ "$BUCKET_COUNT" -gt 1 ]; then
    echo "Error: more than one matching bucket found:"
    echo "$BUCKETS"
    echo "       Pin one explicitly and re-run."
    exit 1
fi

BUCKET_NAME="$BUCKETS"
echo "      Found: $BUCKET_NAME"
echo ""

# -- 2. Fetch current task definition ---------------------------------------
echo "[2/5] Fetching current task definition '$TASK_FAMILY'..."
CURRENT_TD=$(aws ecs describe-task-definition \
    --task-definition "$TASK_FAMILY" \
    --region "$REGION" \
    --query 'taskDefinition' \
    --output json)

CURRENT_REV=$(echo "$CURRENT_TD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["revision"])')
CURRENT_ARN=$(echo "$CURRENT_TD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["taskDefinitionArn"])')
echo "      Current revision: $CURRENT_REV"
echo "      Current ARN:      $CURRENT_ARN"
echo ""

# -- 3. Build the new task-definition payload (idempotent) ------------------
echo "[3/5] Building new task definition with S3_BUCKET_NAME + AWS_REGION..."
NEW_TD=$(echo "$CURRENT_TD" | CONTAINER_NAME="$CONTAINER_NAME" \
    BUCKET_NAME="$BUCKET_NAME" REGION="$REGION" python3 - <<'PYEOF'
import json, os, sys

td = json.load(sys.stdin)
container_name = os.environ["CONTAINER_NAME"]
bucket = os.environ["BUCKET_NAME"]
region = os.environ["REGION"]

target = next((c for c in td["containerDefinitions"] if c["name"] == container_name), None)
if target is None:
    print(f"ERROR: no container named '{container_name}' in task def", file=sys.stderr)
    sys.exit(2)

env = target.get("environment", []) or []
desired = {"S3_BUCKET_NAME": bucket, "AWS_REGION": region}
existing = {e["name"]: e["value"] for e in env}

changed = False
for k, v in desired.items():
    if existing.get(k) != v:
        changed = True
        break

if not changed:
    # Signal "no-op" to the wrapper.
    print("__NOOP__")
    sys.exit(0)

new_env = [e for e in env if e["name"] not in desired]
for k, v in desired.items():
    new_env.append({"name": k, "value": v})
target["environment"] = new_env

# Strip server-managed fields that register-task-definition rejects.
for f in ("taskDefinitionArn", "revision", "status", "requiresAttributes",
          "compatibilities", "registeredAt", "registeredBy",
          "deregisteredAt"):
    td.pop(f, None)

print(json.dumps(td))
PYEOF
)

if [ "$NEW_TD" = "__NOOP__" ]; then
    echo "      Already set correctly (S3_BUCKET_NAME=$BUCKET_NAME, AWS_REGION=$REGION)."
    echo "      Nothing to do. Exiting."
    exit 0
fi

# Show the diff for confirmation.
echo "      Will add to container '$CONTAINER_NAME' env:"
echo "        S3_BUCKET_NAME = $BUCKET_NAME"
echo "        AWS_REGION     = $REGION"
echo ""
read -p "Register new task revision and roll service '$SERVICE'? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# -- 4. Register new revision ----------------------------------------------
echo ""
echo "[4/5] Registering new task definition revision..."
TMPFILE=$(mktemp /tmp/td.XXXXXX.json)
echo "$NEW_TD" > "$TMPFILE"
NEW_ARN=$(aws ecs register-task-definition \
    --region "$REGION" \
    --cli-input-json "file://$TMPFILE" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)
rm -f "$TMPFILE"
NEW_REV=$(echo "$NEW_ARN" | awk -F: '{print $NF}')
echo "      Registered: $NEW_ARN  (revision $NEW_REV)"
echo ""

# -- 5. Roll the service ----------------------------------------------------
echo "[5/5] Updating service '$SERVICE' on cluster '$CLUSTER' to revision $NEW_REV..."
aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --task-definition "$NEW_ARN" \
    --region "$REGION" \
    --query 'service.{taskDef:taskDefinition,desired:desiredCount,deployments:deployments[*].{status:status,rollout:rolloutState,taskDef:taskDefinition}}' \
    --output json

echo ""
echo "=== Done. ==="
echo ""
echo "Watch the rollout:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE \\"
echo "    --region $REGION \\"
echo "    --query 'services[0].deployments[*].{status:status,rollout:rolloutState,taskDef:taskDefinition,running:runningCount,desired:desiredCount}'"
echo ""
echo "Roll back if needed:"
echo "  aws ecs update-service --cluster $CLUSTER --service $SERVICE \\"
echo "    --task-definition $CURRENT_ARN --region $REGION"
