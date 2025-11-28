# Solar APU - Security and Compliance Guide

> **SOC2, ISO27001, CIS AWS Foundations, and AWS Best Practices**

---

## Overview

This document outlines the security controls and compliance measures implemented in the Solar APU infrastructure to meet enterprise security requirements.

---

## Compliance Framework Mapping

### SOC2 Type II Controls

| Control | Description | Implementation |
|---------|-------------|----------------|
| CC1.1 | Control Environment | IAM policies, RBAC, least privilege |
| CC2.1 | Communication | Encrypted transit (TLS 1.2+) |
| CC3.1 | Risk Assessment | GuardDuty threat detection |
| CC4.1 | Monitoring | CloudWatch, CloudTrail |
| CC5.1 | Control Activities | Security groups, NACLs |
| CC6.1 | Logical Access | IAM, session management |
| CC6.6 | System Operations | ECS Fargate (managed) |
| CC6.7 | Change Management | GitHub Actions CI/CD |
| CC7.1 | System Monitoring | CloudWatch alarms |
| CC7.2 | Incident Response | GuardDuty + SNS alerts |
| CC7.3 | Security Events | CloudTrail audit logs |
| CC8.1 | Change Management | Terraform IaC |

### ISO 27001 Controls

| Control | Description | Implementation |
|---------|-------------|----------------|
| A.5.1 | Security Policies | Infrastructure as Code |
| A.6.1 | Organization | RBAC with defined roles |
| A.8.1 | Asset Management | Terraform state tracking |
| A.9.1 | Access Control | IAM policies, security groups |
| A.10.1 | Cryptography | KMS encryption, TLS |
| A.12.1 | Operations Security | ECS managed containers |
| A.12.4 | Logging and Monitoring | CloudWatch, CloudTrail |
| A.13.1 | Network Security | VPC, security groups, NACLs |
| A.14.1 | System Security | Encrypted at rest and transit |
| A.16.1 | Incident Management | GuardDuty, SNS alerts |
| A.17.1 | Business Continuity | Multi-AZ, RDS backups |
| A.18.1 | Compliance | Audit logging, encryption |

### CIS AWS Foundations Benchmark

| CIS Control | Description | Status |
|-------------|-------------|--------|
| 1.1 | Avoid root account usage | Manual |
| 1.4 | IAM password policy | Configured |
| 1.16 | IAM policies attached to groups/roles | Implemented |
| 2.1 | CloudTrail enabled in all regions | Enabled |
| 2.3 | CloudTrail log file validation | Enabled |
| 2.4 | CloudTrail integrated with CloudWatch | Configured |
| 2.6 | S3 bucket access logging | Enabled |
| 3.1-3.14 | CloudWatch log metric filters | Configured |
| 4.1 | Security group SSH restricted | Implemented |
| 4.3 | Security group default deny | Implemented |
| 4.4 | VPC Flow Logs enabled | Enabled |

---

## Security Controls Implementation

### 1. Network Security

#### VPC Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VPC (10.0.0.0/16)                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Internet Gateway                          ││
│  └────────────────────────────┬────────────────────────────────┘│
│                               │                                  │
│  ┌────────────────────────────┼────────────────────────────────┐│
│  │                PUBLIC SUBNETS                               ││
│  │  ┌──────────────┐         │         ┌──────────────┐        ││
│  │  │ ALB Node 1   │◄────────┤────────►│ ALB Node 2   │        ││
│  │  │ 10.0.1.0/24  │         │         │ 10.0.2.0/24  │        ││
│  │  └──────────────┘         │         └──────────────┘        ││
│  │                           │                                  ││
│  │  ┌──────────────┐         │                                  ││
│  │  │ NAT Gateway  │◄────────┘                                  ││
│  │  └──────┬───────┘                                           ││
│  └─────────┼────────────────────────────────────────────────────┘│
│            │                                                     │
│  ┌─────────┼────────────────────────────────────────────────────┐│
│  │         │          PRIVATE SUBNETS                           ││
│  │         │  ┌──────────────┐         ┌──────────────┐         ││
│  │         └─►│ ECS Task 1   │         │ ECS Task 2   │         ││
│  │            │ 10.0.11.0/24 │         │ 10.0.12.0/24 │         ││
│  │            └──────┬───────┘         └──────┬───────┘         ││
│  └───────────────────┼─────────────────────────┼────────────────┘│
│                      │                         │                 │
│  ┌───────────────────┼─────────────────────────┼────────────────┐│
│  │                   │  DATABASE SUBNETS (ISOLATED)             ││
│  │                   │  ┌──────────────┐                        ││
│  │                   └─►│ RDS Primary  │ (No internet access)   ││
│  │                      │ 10.0.21.0/24 │                        ││
│  │                      └──────────────┘                        ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### Security Groups

| Security Group | Inbound Rules | Outbound Rules |
|----------------|---------------|----------------|
| ALB-SG | 443/tcp from 0.0.0.0/0, 80/tcp from 0.0.0.0/0 | All traffic |
| ECS-SG | 5000/tcp from ALB-SG only | All traffic |
| RDS-SG | 5432/tcp from ECS-SG only | All traffic |

### 2. Data Encryption

#### Encryption at Rest

| Resource | Encryption | Key Management |
|----------|------------|----------------|
| RDS PostgreSQL | AES-256 | AWS managed KMS |
| S3 Buckets | AES-256 (SSE-S3) | AWS managed |
| EBS Volumes | AES-256 | AWS managed KMS |
| Secrets Manager | AES-256 | AWS managed KMS |
| CloudTrail Logs | AES-256 (S3 SSE) | AWS managed |

#### Encryption in Transit

| Connection | Protocol | Minimum Version |
|------------|----------|-----------------|
| Client → ALB | TLS | 1.2 |
| ALB → ECS | HTTP (internal VPC) | N/A |
| ECS → RDS | TLS | 1.2 |

**Note**: ALB to ECS uses HTTP within the private VPC. For stricter requirements, enable end-to-end TLS.

### 3. Access Control

#### IAM Roles

```
┌─────────────────────────────────────────────────────────────────┐
│                        IAM Architecture                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ ECS Execution   │    │ ECS Task        │                     │
│  │ Role            │    │ Role            │                     │
│  │                 │    │                 │                     │
│  │ - Pull ECR      │    │ - S3 access     │                     │
│  │ - Get secrets   │    │ - CloudWatch    │                     │
│  │ - Write logs    │    │   metrics       │                     │
│  └─────────────────┘    └─────────────────┘                     │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ GitHub Actions  │    │ VPC Flow Logs   │                     │
│  │ Role            │    │ Role            │                     │
│  │                 │    │                 │                     │
│  │ - Deploy ECS    │    │ - Write to      │                     │
│  │ - Push ECR      │    │   CloudWatch    │                     │
│  │ - Terraform     │    │                 │                     │
│  └─────────────────┘    └─────────────────┘                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Application RBAC

Implement these roles in your application:

| Role | Description | Permissions |
|------|-------------|-------------|
| Super Admin | Platform administrator | All organizations, all resources |
| Org Admin | Organization administrator | Own organization, all users |
| Manager | Team manager | Own team resources, read-only users |
| User | Standard user | Own resources only |
| Viewer | Read-only access | Read-only on assigned resources |

### 4. Audit Logging

#### CloudTrail Configuration

```hcl
resource "aws_cloudtrail" "main" {
  name                          = "solar-apu-audit-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }
}
```

#### Application Audit Logging

Implement audit logging in your application:

```typescript
// server/middleware/audit.ts
import { db } from "../db";
import { auditLogs } from "@shared/schema";

export async function logAuditEvent(
  userId: number | null,
  organizationId: number | null,
  action: string,
  resource: string,
  resourceId: string,
  details: Record<string, unknown>,
  req: Request
) {
  await db.insert(auditLogs).values({
    userId,
    organizationId,
    action,
    resource,
    resourceId,
    details: JSON.stringify(details),
    ipAddress: req.ip || req.headers["x-forwarded-for"]?.toString(),
    userAgent: req.headers["user-agent"],
  });
}

// Usage in routes
router.post("/api/users", async (req, res) => {
  const user = await createUser(req.body);
  
  await logAuditEvent(
    req.user?.id,
    req.user?.organizationId,
    "CREATE",
    "users",
    user.id.toString(),
    { email: user.email },
    req
  );
  
  res.json(user);
});
```

### 5. Threat Detection

#### GuardDuty

GuardDuty is enabled by default with:
- VPC Flow Log analysis
- DNS query analysis
- CloudTrail event analysis
- S3 data plane monitoring
- Malware protection for EC2

#### Alerts Configuration

```hcl
resource "aws_cloudwatch_event_rule" "guardduty" {
  name        = "guardduty-findings"
  description = "Capture GuardDuty findings"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
    detail = {
      severity = [{ numeric = [">=", 4] }]  # Medium and above
    }
  })
}
```

---

## Security Checklist

### Pre-Deployment

- [ ] IAM user created with least privilege
- [ ] MFA enabled on AWS root account
- [ ] Strong passwords generated for secrets
- [ ] GitHub secrets configured
- [ ] ECR repository created with scanning enabled

### Post-Deployment

- [ ] HTTPS working with valid certificate
- [ ] Security groups verified (no 0.0.0.0/0 on sensitive ports)
- [ ] RDS not publicly accessible
- [ ] CloudTrail enabled and logging
- [ ] GuardDuty enabled and monitored
- [ ] VPC Flow Logs enabled
- [ ] CloudWatch alarms configured
- [ ] SNS alerts configured with valid email

### Ongoing

- [ ] Weekly review of GuardDuty findings
- [ ] Monthly security group audit
- [ ] Monthly IAM permission review
- [ ] Quarterly penetration testing (recommended)
- [ ] Annual security assessment

---

## Incident Response Plan

### Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| Critical | Active breach, data exfiltration | Immediate (< 15 min) |
| High | Suspicious activity, potential vulnerability | < 1 hour |
| Medium | Policy violation, misconfiguration | < 4 hours |
| Low | Minor security issue, informational | < 24 hours |

### Response Procedures

#### Critical Incident

1. **Contain**: Isolate affected resources
   ```bash
   # Revoke security group access
   aws ec2 revoke-security-group-ingress \
     --group-id sg-xxx \
     --protocol all \
     --cidr 0.0.0.0/0
   ```

2. **Assess**: Gather evidence
   ```bash
   # Download CloudTrail logs
   aws s3 sync s3://solar-apu-cloudtrail/ ./incident-logs/
   ```

3. **Eradicate**: Remove threat

4. **Recover**: Restore from known-good state

5. **Document**: Complete incident report

---

## Security Hardening Recommendations

### Additional Controls (Not Included by Default)

| Control | Description | Cost Impact |
|---------|-------------|-------------|
| AWS WAF | Web application firewall | ~$5/month + requests |
| AWS Shield | DDoS protection | Free (Standard) |
| VPC Endpoints | Private connectivity to AWS services | ~$10/month per endpoint |
| KMS CMK | Customer-managed encryption keys | ~$1/month per key |
| AWS Config | Resource configuration tracking | ~$3/month |

### Enable AWS WAF

```hcl
resource "aws_wafv2_web_acl" "main" {
  name        = "solar-apu-waf"
  scope       = "REGIONAL"
  description = "WAF for Solar APU"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "SolarAPUWAFMetric"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "main" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}
```

---

## Compliance Documentation

### Required Documents for Audit

1. **System Security Plan (SSP)** - Architecture and controls description
2. **Risk Assessment** - Identified risks and mitigations
3. **Access Control Policy** - IAM and RBAC policies
4. **Incident Response Plan** - Procedures and contacts
5. **Business Continuity Plan** - RTO/RPO and recovery procedures
6. **Change Management Policy** - CI/CD and approval process
7. **Data Classification** - Data types and handling requirements
8. **Vendor Management** - AWS shared responsibility model

### Evidence Collection

For SOC2 audits, collect:

- CloudTrail logs (API activity)
- CloudWatch logs (application logs)
- IAM policy documents
- Security group configurations
- Encryption settings (RDS, S3)
- GitHub Actions audit logs
- Terraform state files

---

*Document Version: 1.0*
*Last Updated: November 2024*
