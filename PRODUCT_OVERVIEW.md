# Deecell Fleet Tracking Dashboard

> A real-time monitoring system for managing clean energy truck fleets

---

## Application Purpose

A **multi-tenant fleet management system** for monitoring clean energy trucks equipped with PowerMon battery/solar devices. Provides real-time visibility into truck locations, battery states, idle-reduction fuel savings, and system health.

---

## Core Components

### 1. Customer Dashboard (Frontend)

**Purpose:** Fleet operators view and manage their trucks

| Feature | Description |
|---------|-------------|
| Fleet Table | Real-time truck status (Driving/Parked/Idling), battery SOC, voltage, temperature |
| Map View | Static map with SVG truck location overlays |
| Savings Display | Daily/monthly fuel cost savings from idle reduction |
| Historical Charts | Performance visualization over time |
| Alerts System | Low voltage, critical SOC, device offline notifications |
| AI Fleet Assistant | Natural language queries for fleet insights |

### 2. Admin Dashboard

**Purpose:** Deecell Operations manages all customers

| Page | Function |
|------|----------|
| Organizations | Create/manage customer accounts |
| Fleets | Organize trucks into logical groups |
| Trucks | Vehicle provisioning and tracking |
| Devices | PowerMon device management and assignment |
| Users | Customer user accounts and roles |
| GitHub Issues | Track development tasks |

### 3. Device Manager (Standalone Service)

**Purpose:** Production data collection service for AWS EC2

| Capability | Details |
|------------|---------|
| PowerMon Polling | 10-second intervals via native C++ addon |
| SIM Polling | 60-second intervals via SIMPro API |
| Architecture | Cohort-based sharding, batch writes, gap detection |
| Scale Target | ~1,000 devices per instance, horizontally scalable |

### 4. Backend API (Express.js)

**Purpose:** REST API with multi-tenant isolation

- Session-based authentication with bcrypt password hashing
- Automatic organization scoping via tenant middleware
- CRUD operations for all business entities
- Third-party integrations (email, fuel prices, location)

### 5. Database (PostgreSQL)

**Purpose:** Persistent storage with Drizzle ORM

- 20+ tables for organizations, users, trucks, devices, measurements, alerts
- Multi-tenancy via `organization_id` on all business tables
- Hosted on AWS RDS with encryption and automated backups

---

## Key Integrations

| Integration | Provider | Purpose |
|-------------|----------|---------|
| PowerMon | Thornwave | Battery/solar monitoring devices |
| SIMPro | Wireless Logic | SIM card location tracking (country/network) |
| EIA API | U.S. Energy Information Administration | Regional diesel fuel prices |
| SendGrid | Twilio | Email notifications (password reset, alerts, welcome) |
| OpenAI | OpenAI | AI Fleet Assistant (GPT-4o-mini) |
| AWS | Amazon | Production infrastructure (ECS, RDS, EC2, ALB) |

---

## Savings Calculation

The system calculates fuel cost savings from idle reduction:

```
Savings = (Parked Minutes / 60) × 1.2 gal/hr × Diesel Price
CO₂ Reduction = Gallons Saved × 22.4 lbs/gallon
```

- Uses regional diesel prices from EIA API
- PADD region determined by truck location
- Default: $3.50/gallon if EIA unavailable

---

## Development Timeline

| Date | Milestone |
|------|-----------|
| **Nov 27, 2025** | Project started - database schema, storage layer |
| **Nov 28, 2025** | Multi-tenant API, test data seeding |
| **Nov 28-29, 2025** | Admin Dashboard (6 pages), Customer Authentication |
| **Nov 29-30, 2025** | Device Manager libpowermon integration, native addon |
| **Dec 1, 2025** | AWS Terraform infrastructure created |
| **Dec 2, 2025** | **AWS Deployment LIVE** - ECS, RDS, EC2 operational |
| **Dec 3, 2025** | Device auto-population, GitHub Issues integration |
| **Dec 4, 2025** | Custom domain (app.deecell.com), SSL/TLS, Admin AI |
| **Dec 5, 2025** | SendGrid email, password reset, Slack daily summary |
| **Dec 9, 2025** | User profile pictures, password change |
| **Dec 11-17, 2025** | SIMPro location API integration, production deployment |
| **Dec 23, 2025** | SIM polling moved to Device Manager |

---

## Production Environment

| Resource | Details |
|----------|---------|
| **Application URL** | https://app.deecell.com |
| **AWS Region** | us-east-2 (Ohio) |
| **Web Application** | ECS Fargate (1-4 tasks, auto-scaling) |
| **Database** | RDS PostgreSQL 15 (encrypted, daily backups) |
| **Device Manager** | EC2 t3.micro (Auto Scaling Group) |
| **Load Balancer** | Application Load Balancer with HTTPS |

---

## Active Customers

| Organization | Devices | Status |
|--------------|---------|--------|
| GTO Fast Racing | DCL-Moeck | Active |
| Carter Racing | DCL-Carter | Active |

---

## Technology Stack

### Frontend
- React 18 with TypeScript
- Vite build tool
- Tailwind CSS + Radix UI + shadcn/ui
- TanStack React Query
- Wouter routing
- Recharts for visualization

### Backend
- Node.js with Express.js
- Drizzle ORM
- PostgreSQL (Neon serverless / AWS RDS)
- Session-based authentication

### Infrastructure
- Terraform for IaC
- GitHub Actions for CI/CD
- AWS (ECS, RDS, EC2, ALB, Secrets Manager, CloudWatch)

---

## Security Features

- Bcrypt password hashing
- Session fixation prevention
- Secure cookie configuration
- Multi-tenant data isolation
- AWS Secrets Manager for credentials
- CloudTrail audit logging
- SOC2/ISO27001 compliance readiness

---

*Last updated: December 2025*
