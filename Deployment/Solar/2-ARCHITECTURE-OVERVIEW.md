# Solar APU - Architecture Overview

> **System design, component interactions, and architectural decisions**

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                        │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AWS CLOUD (us-east-1)                               │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                              VPC (10.0.0.0/16)                        │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │                    Availability Zone A                          │ │  │
│  │  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │ │  │
│  │  │  │ Public      │  │ Private      │  │ Database Subnet     │   │ │  │
│  │  │  │ Subnet      │  │ Subnet       │  │ (Isolated)          │   │ │  │
│  │  │  │ 10.0.1.0/24 │  │ 10.0.11.0/24 │  │ 10.0.21.0/24        │   │ │  │
│  │  │  │             │  │              │  │                      │   │ │  │
│  │  │  │ ┌─────────┐ │  │ ┌──────────┐ │  │ ┌──────────────────┐ │   │ │  │
│  │  │  │ │   ALB   │ │  │ │ ECS Task │ │  │ │ RDS PostgreSQL   │ │   │ │  │
│  │  │  │ │ (Node)  │ │  │ │ (Fargate)│ │  │ │ (Primary)        │ │   │ │  │
│  │  │  │ └────┬────┘ │  │ └─────┬────┘ │  │ └────────┬─────────┘ │   │ │  │
│  │  │  │      │      │  │       │      │  │          │           │   │ │  │
│  │  │  │ ┌────┴────┐ │  │       │      │  │          │           │   │ │  │
│  │  │  │ │   NAT   │ │  │       │      │  │          │           │   │ │  │
│  │  │  │ │ Gateway │ │  │       │      │  │          │           │   │ │  │
│  │  │  │ └─────────┘ │  │       │      │  │          │           │   │ │  │
│  │  │  └─────────────┘  └───────┼──────┘  └──────────┼───────────┘   │ │  │
│  │  └───────────────────────────┼────────────────────┼───────────────┘ │  │
│  │                              │                    │                  │  │
│  │  ┌───────────────────────────┼────────────────────┼───────────────┐ │  │
│  │  │                    Availability Zone B         │               │ │  │
│  │  │  ┌─────────────┐  ┌──────┴───────┐  ┌─────────┴────────────┐  │ │  │
│  │  │  │ Public      │  │ Private      │  │ Database Subnet     │  │ │  │
│  │  │  │ Subnet      │  │ Subnet       │  │ (Isolated)          │  │ │  │
│  │  │  │ 10.0.2.0/24 │  │ 10.0.12.0/24 │  │ 10.0.22.0/24        │  │ │  │
│  │  │  │             │  │              │  │                      │  │ │  │
│  │  │  │ ┌─────────┐ │  │ ┌──────────┐ │  │ ┌──────────────────┐ │  │ │  │
│  │  │  │ │   ALB   │ │  │ │ ECS Task │ │  │ │ RDS PostgreSQL   │ │  │ │  │
│  │  │  │ │ (Node)  │ │  │ │ (Fargate)│ │  │ │ (Standby)        │ │  │ │  │
│  │  │  │ └─────────┘ │  │ └──────────┘ │  │ └──────────────────┘ │  │ │  │
│  │  │  └─────────────┘  └──────────────┘  └──────────────────────┘  │ │  │
│  │  └───────────────────────────────────────────────────────────────┘ │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │
│  │ CloudTrail   │ │ GuardDuty    │ │ CloudWatch   │ │ Secrets Manager  │    │
│  │ (Audit)      │ │ (Threat Det) │ │ (Monitoring) │ │ (Credentials)    │    │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────────┘    │
│                                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                         │
│  │ ECR          │ │ S3           │ │ ACM          │                         │
│  │ (Container)  │ │ (Storage)    │ │ (SSL Certs)  │                         │
│  └──────────────┘ └──────────────┘ └──────────────┘                         │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### Application Layer

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | React + Vite | Single-page application |
| Backend | Express.js | REST API server |
| ORM | Drizzle | Database queries with type safety |
| Validation | Zod | Request/response validation |
| Auth | Express Session + Passport | User authentication |

### Infrastructure Layer

| Component | AWS Service | Purpose |
|-----------|-------------|---------|
| Load Balancer | ALB | Traffic distribution, SSL termination |
| Compute | ECS Fargate | Serverless container hosting |
| Database | RDS PostgreSQL | Primary data store |
| Container Registry | ECR | Docker image storage |
| Secrets | Secrets Manager | Credential management |
| Logging | CloudWatch | Centralized logging |
| Monitoring | CloudWatch | Metrics and alarms |

### Security Layer

| Component | AWS Service | Purpose |
|-----------|-------------|---------|
| Threat Detection | GuardDuty | Anomaly detection |
| Audit Logging | CloudTrail | API activity logging |
| SSL Certificates | ACM | TLS/SSL management |
| Network Isolation | VPC + Security Groups | Traffic control |

---

## Data Flow

### Request Flow

```
User Request
     │
     ▼
┌─────────────┐
│ CloudFront  │  (Optional CDN)
│ / Route 53  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│     ALB     │  ◄── SSL Termination
│  (HTTPS)    │  ◄── Health Checks
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ ECS Fargate │  ◄── Container Orchestration
│   Tasks     │  ◄── Auto-scaling
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    RDS      │  ◄── Connection Pooling
│ PostgreSQL  │  ◄── Encrypted at Rest
└─────────────┘
```

### Authentication Flow

```
1. User Login Request
        │
        ▼
┌───────────────────────┐
│ POST /api/auth/login  │
│ {email, password}     │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ Validate Credentials  │
│ (bcrypt compare)      │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ Create Session        │
│ (PostgreSQL store)    │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ Set Session Cookie    │
│ (HttpOnly, Secure)    │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ Log Audit Event       │
│ (User login)          │
└───────────────────────┘
```

---

## Multi-Tenant Data Model

```
┌─────────────────────────────────────────────────────────────────┐
│                         organizations                            │
├─────────────────────────────────────────────────────────────────┤
│ id (PK) │ name │ slug │ plan │ created_at │ settings           │
├─────────┼──────┼──────┼──────┼────────────┼────────────────────┤
│ 1       │ Acme │ acme │ pro  │ 2024-01-01 │ {...}              │
│ 2       │ Beta │ beta │ free │ 2024-02-01 │ {...}              │
└─────────────────────────────────────────────────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                            users                                 │
├─────────────────────────────────────────────────────────────────┤
│ id │ email │ organization_id (FK) │ role │ is_active           │
├────┼───────┼──────────────────────┼──────┼─────────────────────┤
│ 1  │ a@... │ 1                    │ admin│ true                │
│ 2  │ b@... │ 1                    │ user │ true                │
│ 3  │ c@... │ 2                    │ admin│ true                │
└─────────────────────────────────────────────────────────────────┘
         │
         │ 1:N (tenant-scoped data)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    [your_business_data]                          │
├─────────────────────────────────────────────────────────────────┤
│ id │ organization_id (FK) │ ... your columns ...                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Architecture

### Network Security

```
                              INTERNET
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
           ┌───────────────┐           ┌───────────────┐
           │ HTTPS (443)   │           │ HTTP (80)     │
           │ Allowed       │           │ → Redirect    │
           └───────┬───────┘           └───────────────┘
                   │
                   ▼
           ┌───────────────┐
           │ ALB Security  │  ◄── WAF Rules (optional)
           │ Group         │
           └───────┬───────┘
                   │ Port 5000
                   ▼
           ┌───────────────┐
           │ ECS Security  │  ◄── Only from ALB
           │ Group         │
           └───────┬───────┘
                   │ Port 5432
                   ▼
           ┌───────────────┐
           │ RDS Security  │  ◄── Only from ECS
           │ Group         │  ◄── No public access
           └───────────────┘
```

### Encryption

| Data State | Encryption Method |
|------------|-------------------|
| In Transit | TLS 1.2+ (ALB to client) |
| In Transit | TLS (ECS to RDS via SSL) |
| At Rest (RDS) | AES-256 (AWS KMS) |
| At Rest (S3) | AES-256 (Server-side) |
| Secrets | AWS Secrets Manager |
| Session Data | PostgreSQL (encrypted disk) |

### Access Control

```
┌─────────────────────────────────────────────────────────────────┐
│                      RBAC Model                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │ Super Admin  │   │ Org Admin    │   │ User         │        │
│  │              │   │              │   │              │        │
│  │ - All orgs   │   │ - Own org    │   │ - Own data   │        │
│  │ - All users  │   │ - Org users  │   │ - Read org   │        │
│  │ - System cfg │   │ - Org config │   │              │        │
│  └──────────────┘   └──────────────┘   └──────────────┘        │
│                                                                  │
│  Permission Matrix:                                              │
│  ┌────────────────┬────────────┬──────────┬──────────┐         │
│  │ Resource       │ SuperAdmin │ OrgAdmin │ User     │         │
│  ├────────────────┼────────────┼──────────┼──────────┤         │
│  │ Organizations  │ CRUD       │ R        │ R        │         │
│  │ Users          │ CRUD       │ CRUD*    │ R (self) │         │
│  │ Audit Logs     │ R          │ R*       │ -        │         │
│  │ Business Data  │ CRUD       │ CRUD*    │ CRUD*    │         │
│  └────────────────┴────────────┴──────────┴──────────┘         │
│                                                                  │
│  * = Scoped to own organization                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Deployment Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│                      CI/CD Pipeline                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Developer                                                        │
│      │                                                            │
│      │ git push                                                   │
│      ▼                                                            │
│  ┌──────────┐                                                     │
│  │  GitHub  │                                                     │
│  └────┬─────┘                                                     │
│       │ trigger                                                   │
│       ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                  GitHub Actions                               ││
│  │                                                               ││
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐      ││
│  │  │ Lint    │──►│ Test    │──►│ Build   │──►│ Push    │      ││
│  │  │         │   │         │   │ Docker  │   │ to ECR  │      ││
│  │  └─────────┘   └─────────┘   └─────────┘   └────┬────┘      ││
│  │                                                  │           ││
│  │  ┌─────────┐   ┌─────────┐   ┌─────────────────┐│           ││
│  │  │ Update  │◄──│ Wait    │◄──│ Deploy to ECS   ││           ││
│  │  │ Status  │   │ Healthy │   │                 ││           ││
│  │  └─────────┘   └─────────┘   └─────────────────┘│           ││
│  │                                                              ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Scaling Strategy

### Horizontal Scaling

| Component | Scaling Method | Trigger |
|-----------|----------------|---------|
| ECS Tasks | Auto Scaling | CPU > 70%, Memory > 80% |
| RDS | Read Replicas | Read-heavy workloads |
| ALB | Automatic | Managed by AWS |

### Capacity Planning

| Tier | ECS Tasks | RDS Instance | Expected Users |
|------|-----------|--------------|----------------|
| Small | 1-2 | db.t3.micro | Up to 100 |
| Medium | 2-4 | db.t3.small | Up to 1,000 |
| Large | 4-8 | db.r5.large | Up to 10,000 |
| Enterprise | 8+ | db.r5.xlarge+ | 10,000+ |

---

## Disaster Recovery

### Backup Strategy

| Component | Backup Method | Retention | RPO |
|-----------|---------------|-----------|-----|
| RDS | Automated snapshots | 7 days | 5 min |
| RDS | Point-in-time recovery | 7 days | 5 min |
| S3 | Versioning | 90 days | 0 |
| Secrets | Automatic | N/A | 0 |

### Recovery Procedures

1. **RDS Failure**: Automatic failover to standby (Multi-AZ)
2. **ECS Task Failure**: Automatic replacement
3. **AZ Failure**: Traffic routes to healthy AZ
4. **Region Failure**: Manual failover to DR region (if configured)

---

## Cost Optimization

### Reserved vs On-Demand

| Component | Recommendation |
|-----------|----------------|
| ECS Fargate | On-Demand (flexible) |
| RDS | Reserved Instance (predictable) |
| NAT Gateway | Consider NAT Instance for dev |

### Cost Monitoring

- Enable AWS Cost Explorer
- Set billing alerts
- Use Cost Allocation Tags
- Review unused resources monthly

---

*Document Version: 1.0*
*Last Updated: November 2024*
