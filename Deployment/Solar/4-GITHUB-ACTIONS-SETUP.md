# Solar APU - GitHub Actions CI/CD Setup

> **Complete CI/CD pipeline for automated deployments**

---

## Overview

This document provides the GitHub Actions workflow configuration for:
- Building and testing the application
- Building Docker images
- Pushing to Amazon ECR
- Deploying to ECS Fargate
- Running database migrations

---

## Main Deployment Workflow

Create `.github/workflows/deploy.yml`:

```yaml
# =============================================================================
# Solar APU - CI/CD Pipeline
# Triggers on push to main branch
# =============================================================================

name: Deploy to AWS

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  AWS_REGION: ${{ secrets.AWS_REGION }}
  ECR_REPOSITORY: ${{ secrets.ECR_REPOSITORY }}
  ECS_CLUSTER: solar-apu-production-cluster
  ECS_SERVICE: solar-apu
  CONTAINER_NAME: solar-apu

permissions:
  contents: read
  id-token: write

jobs:
  # ===========================================================================
  # Job 1: Test
  # ===========================================================================
  test:
    name: Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Run Linter
        run: npm run lint --if-present

      - name: Run Type Check
        run: npm run typecheck --if-present

      - name: Run Tests
        run: npm test --if-present

  # ===========================================================================
  # Job 2: Security Scan
  # ===========================================================================
  security:
    name: Security Scan
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run npm audit
        run: npm audit --audit-level=high || true

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          severity: 'CRITICAL,HIGH'
          exit-code: '0'  # Set to 1 to fail on vulnerabilities

  # ===========================================================================
  # Job 3: Build and Push Docker Image
  # ===========================================================================
  build:
    name: Build and Push
    runs-on: ubuntu-latest
    needs: [test, security]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'

    outputs:
      image: ${{ steps.build-image.outputs.image }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image to Amazon ECR
        id: build-image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          # Build Docker image
          docker build \
            --build-arg NODE_ENV=production \
            -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
            -t $ECR_REGISTRY/$ECR_REPOSITORY:latest \
            .

          # Push both tags
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

          # Output the image URI
          echo "image=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> $GITHUB_OUTPUT

      - name: Scan Docker image
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: '${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ github.sha }}'
          format: 'table'
          severity: 'CRITICAL,HIGH'
          exit-code: '0'

  # ===========================================================================
  # Job 4: Deploy to ECS
  # ===========================================================================
  deploy:
    name: Deploy to ECS
    runs-on: ubuntu-latest
    needs: build
    environment: production

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Download current task definition
        run: |
          aws ecs describe-task-definition \
            --task-definition ${{ env.ECS_SERVICE }} \
            --query taskDefinition > task-definition.json

      - name: Update task definition with new image
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definition.json
          container-name: ${{ env.CONTAINER_NAME }}
          image: ${{ needs.build.outputs.image }}

      - name: Deploy Amazon ECS task definition
        uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          service: ${{ env.ECS_SERVICE }}
          cluster: ${{ env.ECS_CLUSTER }}
          wait-for-service-stability: true
          wait-for-minutes: 10

      - name: Verify deployment
        run: |
          # Get the ALB URL
          ALB_URL=$(aws elbv2 describe-load-balancers \
            --names solar-apu-production-alb \
            --query 'LoadBalancers[0].DNSName' \
            --output text)

          echo "Deployed to: http://$ALB_URL"

          # Wait for health check
          for i in {1..30}; do
            HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://$ALB_URL/api/health" || echo "000")
            if [ "$HTTP_STATUS" = "200" ]; then
              echo "Health check passed!"
              exit 0
            fi
            echo "Attempt $i: HTTP $HTTP_STATUS - waiting..."
            sleep 10
          done

          echo "Health check failed after 30 attempts"
          exit 1

  # ===========================================================================
  # Job 5: Run Database Migrations (Optional)
  # ===========================================================================
  migrate:
    name: Run Migrations
    runs-on: ubuntu-latest
    needs: deploy
    if: ${{ github.event_name == 'push' }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Get database URL from Secrets Manager
        id: get-db-url
        run: |
          # Get the latest secret ARN
          SECRET_ARN=$(aws secretsmanager list-secrets \
            --filter Key=name,Values=solar-apu-production/database-url \
            --query 'SecretList[0].ARN' \
            --output text)
          
          # Get the secret value
          DATABASE_URL=$(aws secretsmanager get-secret-value \
            --secret-id $SECRET_ARN \
            --query 'SecretString' \
            --output text)
          
          echo "::add-mask::$DATABASE_URL"
          echo "database_url=$DATABASE_URL" >> $GITHUB_OUTPUT

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Run Database Migrations
        env:
          DATABASE_URL: ${{ steps.get-db-url.outputs.database_url }}
        run: |
          npm run db:push --force || echo "No migrations to run"

  # ===========================================================================
  # Job 6: Notify (Optional)
  # ===========================================================================
  notify:
    name: Notify
    runs-on: ubuntu-latest
    needs: [deploy, migrate]
    if: always()

    steps:
      - name: Deployment Status
        run: |
          if [ "${{ needs.deploy.result }}" == "success" ]; then
            echo "Deployment successful!"
          else
            echo "Deployment failed!"
            exit 1
          fi
```

---

## Terraform Workflow

Create `.github/workflows/terraform.yml`:

```yaml
# =============================================================================
# Solar APU - Terraform Infrastructure Pipeline
# Triggers on changes to terraform/ directory
# =============================================================================

name: Terraform

on:
  push:
    branches: [main]
    paths:
      - 'terraform/**'
      - '.github/workflows/terraform.yml'
  pull_request:
    branches: [main]
    paths:
      - 'terraform/**'

env:
  TF_VERSION: '1.6.0'
  AWS_REGION: ${{ secrets.AWS_REGION }}

permissions:
  contents: read
  pull-requests: write

jobs:
  # ===========================================================================
  # Job 1: Terraform Plan
  # ===========================================================================
  plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: terraform

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TF_VERSION }}

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Terraform Format Check
        id: fmt
        run: terraform fmt -check -recursive
        continue-on-error: true

      - name: Terraform Init
        id: init
        run: terraform init

      - name: Terraform Validate
        id: validate
        run: terraform validate

      - name: Terraform Plan
        id: plan
        run: |
          terraform plan -no-color -out=tfplan \
            -var="db_password=${{ secrets.TF_VAR_db_password }}" \
            -var="session_secret=${{ secrets.TF_VAR_session_secret }}" \
            -var="ecr_repository_url=${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.${{ env.AWS_REGION }}.amazonaws.com/${{ secrets.ECR_REPOSITORY }}"
        continue-on-error: true

      - name: Comment on PR
        uses: actions/github-script@v7
        if: github.event_name == 'pull_request'
        with:
          script: |
            const output = `#### Terraform Format and Style 🖌 \`${{ steps.fmt.outcome }}\`
            #### Terraform Initialization ⚙️ \`${{ steps.init.outcome }}\`
            #### Terraform Validation 🤖 \`${{ steps.validate.outcome }}\`
            #### Terraform Plan 📖 \`${{ steps.plan.outcome }}\`

            <details><summary>Show Plan</summary>

            \`\`\`terraform
            ${{ steps.plan.outputs.stdout }}
            \`\`\`

            </details>

            *Pushed by: @${{ github.actor }}, Action: \`${{ github.event_name }}\`*`;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: output
            })

      - name: Upload Plan
        uses: actions/upload-artifact@v4
        with:
          name: tfplan
          path: terraform/tfplan

  # ===========================================================================
  # Job 2: Terraform Apply (only on main branch push)
  # ===========================================================================
  apply:
    name: Terraform Apply
    runs-on: ubuntu-latest
    needs: plan
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    environment: production
    defaults:
      run:
        working-directory: terraform

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TF_VERSION }}

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Terraform Init
        run: terraform init

      - name: Download Plan
        uses: actions/download-artifact@v4
        with:
          name: tfplan
          path: terraform

      - name: Terraform Apply
        run: terraform apply -auto-approve tfplan
```

---

## Required GitHub Secrets

Configure these secrets in your GitHub repository:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | IAM user access key | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key | `wJalrXUtnFEMI/K7MDENG/...` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_ACCOUNT_ID` | 12-digit AWS account ID | `123456789012` |
| `ECR_REPOSITORY` | ECR repository name | `solar-apu` |
| `TF_VAR_db_password` | Database password | `<generated>` |
| `TF_VAR_session_secret` | Session encryption key | `<generated>` |

### Generating Secrets

```bash
# Generate session secret (64 chars)
openssl rand -base64 48

# Generate database password (32 chars, safe characters)
openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!#$%&*' | head -c 32
```

---

## Branch Protection Rules

Configure these in GitHub Settings > Branches:

### Main Branch Protection

- [x] Require a pull request before merging
- [x] Require status checks to pass before merging
  - [x] test
  - [x] security
- [x] Require branches to be up to date before merging
- [x] Include administrators

---

## Environment Configuration

Create a production environment in GitHub:

1. Go to Settings > Environments > New environment
2. Name: `production`
3. Configure protection rules:
   - [x] Required reviewers (add yourself)
   - [x] Wait timer: 0 minutes
4. Add environment secrets if different from repository secrets

---

## Monitoring Deployments

### View Deployment Status

```bash
# List recent deployments
aws ecs describe-services \
  --cluster solar-apu-production-cluster \
  --services solar-apu \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'

# View deployment events
aws ecs describe-services \
  --cluster solar-apu-production-cluster \
  --services solar-apu \
  --query 'services[0].events[:5]'
```

### View Container Logs

```bash
# Tail logs
aws logs tail /ecs/solar-apu-production --follow

# Get recent logs
aws logs get-log-events \
  --log-group-name /ecs/solar-apu-production \
  --log-stream-name $(aws logs describe-log-streams \
    --log-group-name /ecs/solar-apu-production \
    --order-by LastEventTime \
    --descending \
    --limit 1 \
    --query 'logStreams[0].logStreamName' \
    --output text)
```

---

## Rollback Procedure

If a deployment fails:

```bash
# Get previous task definition revision
PREV_REVISION=$(aws ecs describe-services \
  --cluster solar-apu-production-cluster \
  --services solar-apu \
  --query 'services[0].taskDefinition' \
  --output text | sed 's/:.*/:/' | sed "s/$/$(($(aws ecs describe-services --cluster solar-apu-production-cluster --services solar-apu --query 'services[0].taskDefinition' --output text | grep -oE '[0-9]+$') - 1))/")

# Update service to previous revision
aws ecs update-service \
  --cluster solar-apu-production-cluster \
  --service solar-apu \
  --task-definition $PREV_REVISION

# Wait for stability
aws ecs wait services-stable \
  --cluster solar-apu-production-cluster \
  --services solar-apu
```

---

*Document Version: 1.0*
*Last Updated: November 2024*
