# Solar APU - Multi-Tenancy Implementation Guide

> **Architecture and implementation for secure multi-tenant SaaS**

---

## Overview

This guide covers implementing secure multi-tenancy with complete data isolation between organizations (tenants).

---

## Multi-Tenancy Models

### Model Comparison

| Model | Isolation | Cost | Complexity |
|-------|-----------|------|------------|
| **Shared Database (Chosen)** | Row-level | Low | Medium |
| Schema per Tenant | Schema-level | Medium | High |
| Database per Tenant | Full | High | Very High |

**We use the Shared Database model** with row-level security for cost efficiency while maintaining strong isolation.

---

## Database Schema

### Core Tables

```typescript
// shared/schema.ts

import { pgTable, serial, text, timestamp, integer, boolean, varchar, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// =============================================================================
// ORGANIZATIONS (Tenants)
// =============================================================================
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").default("free"), // free, starter, pro, enterprise
  isActive: boolean("is_active").default(true),
  settings: text("settings"), // JSON for tenant-specific settings
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  slugIdx: index("org_slug_idx").on(table.slug),
}));

// =============================================================================
// USERS
// =============================================================================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").default("user"), // super_admin, org_admin, manager, user, viewer
  isActive: boolean("is_active").default(true),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  emailOrgIdx: index("user_email_org_idx").on(table.email, table.organizationId),
  orgIdx: index("user_org_idx").on(table.organizationId),
}));

// Email unique within organization, not globally
// This allows the same email to exist in different organizations

// =============================================================================
// AUDIT LOGS (SOC2 Requirement)
// =============================================================================
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(), // CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT
  resource: text("resource").notNull(), // users, projects, settings, etc.
  resourceId: text("resource_id"),
  details: text("details"), // JSON with additional context
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdx: index("audit_org_idx").on(table.organizationId),
  createdAtIdx: index("audit_created_at_idx").on(table.createdAt),
}));

// =============================================================================
// SESSIONS
// =============================================================================
export const sessions = pgTable("sessions", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: text("sess").notNull(),
  expire: timestamp("expire").notNull(),
}, (table) => ({
  expireIdx: index("session_expire_idx").on(table.expire),
}));

// =============================================================================
// YOUR BUSINESS TABLES (Example)
// =============================================================================
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").default("active"),
  createdById: integer("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdx: index("project_org_idx").on(table.organizationId),
}));

// =============================================================================
// INSERT SCHEMAS
// =============================================================================
export const insertOrganizationSchema = createInsertSchema(organizations)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, createdAt: true, updatedAt: true, lastLoginAt: true });

export const insertAuditLogSchema = createInsertSchema(auditLogs)
  .omit({ id: true, createdAt: true });

export const insertProjectSchema = createInsertSchema(projects)
  .omit({ id: true, createdAt: true, updatedAt: true });

// =============================================================================
// TYPES
// =============================================================================
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Project = typeof projects.$inferSelect;

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type InsertProject = z.infer<typeof insertProjectSchema>;
```

---

## Tenant Context Middleware

### Extracting Tenant from Request

```typescript
// server/middleware/tenant.ts

import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface TenantContext {
  organizationId: number;
  organization: {
    id: number;
    name: string;
    slug: string;
    plan: string;
  };
  user: {
    id: number;
    email: string;
    role: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Skip for public routes
  const publicPaths = ["/api/health", "/api/auth/login", "/api/auth/register"];
  if (publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  // Check if user is authenticated
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Get user with organization
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        organizationId: users.organizationId,
        organization: {
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          plan: organizations.plan,
        },
      })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(eq(users.id, req.session.userId))
      .limit(1);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Check if organization is active
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, user.organizationId))
      .limit(1);

    if (!org?.isActive) {
      return res.status(403).json({ error: "Organization is inactive" });
    }

    // Attach tenant context to request
    req.tenant = {
      organizationId: user.organizationId,
      organization: user.organization,
      user: {
        id: user.id,
        email: user.email,
        role: user.role || "user",
      },
    };

    next();
  } catch (error) {
    console.error("Tenant middleware error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
```

---

## Scoped Database Queries

### Storage Interface with Tenant Scoping

```typescript
// server/storage.ts

import { db } from "./db";
import { 
  organizations, users, projects, auditLogs,
  InsertOrganization, InsertUser, InsertProject, InsertAuditLog,
  Organization, User, Project
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  // Organizations
  createOrganization(data: InsertOrganization): Promise<Organization>;
  getOrganizationById(id: number): Promise<Organization | null>;
  getOrganizationBySlug(slug: string): Promise<Organization | null>;
  
  // Users (scoped to organization)
  createUser(orgId: number, data: InsertUser): Promise<User>;
  getUserById(orgId: number, userId: number): Promise<User | null>;
  getUserByEmail(orgId: number, email: string): Promise<User | null>;
  getUsersByOrganization(orgId: number): Promise<User[]>;
  
  // Projects (scoped to organization)
  createProject(orgId: number, data: InsertProject): Promise<Project>;
  getProjectById(orgId: number, projectId: number): Promise<Project | null>;
  getProjectsByOrganization(orgId: number): Promise<Project[]>;
  updateProject(orgId: number, projectId: number, data: Partial<InsertProject>): Promise<Project | null>;
  deleteProject(orgId: number, projectId: number): Promise<boolean>;
  
  // Audit logs
  createAuditLog(data: InsertAuditLog): Promise<void>;
  getAuditLogs(orgId: number, limit?: number): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  // ==========================================================================
  // Organizations
  // ==========================================================================
  async createOrganization(data: InsertOrganization): Promise<Organization> {
    const [org] = await db.insert(organizations).values(data).returning();
    return org;
  }

  async getOrganizationById(id: number): Promise<Organization | null> {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    return org || null;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    return org || null;
  }

  // ==========================================================================
  // Users (ALWAYS scoped to organization)
  // ==========================================================================
  async createUser(orgId: number, data: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({ ...data, organizationId: orgId })
      .returning();
    return user;
  }

  async getUserById(orgId: number, userId: number): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.organizationId, orgId)  // CRITICAL: Always scope!
        )
      )
      .limit(1);
    return user || null;
  }

  async getUserByEmail(orgId: number, email: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.email, email),
          eq(users.organizationId, orgId)  // CRITICAL: Always scope!
        )
      )
      .limit(1);
    return user || null;
  }

  async getUsersByOrganization(orgId: number): Promise<User[]> {
    return db
      .select()
      .from(users)
      .where(eq(users.organizationId, orgId));
  }

  // ==========================================================================
  // Projects (ALWAYS scoped to organization)
  // ==========================================================================
  async createProject(orgId: number, data: InsertProject): Promise<Project> {
    const [project] = await db
      .insert(projects)
      .values({ ...data, organizationId: orgId })
      .returning();
    return project;
  }

  async getProjectById(orgId: number, projectId: number): Promise<Project | null> {
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, orgId)  // CRITICAL: Always scope!
        )
      )
      .limit(1);
    return project || null;
  }

  async getProjectsByOrganization(orgId: number): Promise<Project[]> {
    return db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, orgId))
      .orderBy(desc(projects.createdAt));
  }

  async updateProject(
    orgId: number, 
    projectId: number, 
    data: Partial<InsertProject>
  ): Promise<Project | null> {
    const [project] = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, orgId)  // CRITICAL: Always scope!
        )
      )
      .returning();
    return project || null;
  }

  async deleteProject(orgId: number, projectId: number): Promise<boolean> {
    const result = await db
      .delete(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, orgId)  // CRITICAL: Always scope!
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  // ==========================================================================
  // Audit Logs
  // ==========================================================================
  async createAuditLog(data: InsertAuditLog): Promise<void> {
    await db.insert(auditLogs).values(data);
  }

  async getAuditLogs(orgId: number, limit = 100): Promise<any[]> {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
```

---

## Route Implementation

### Tenant-Scoped Routes

```typescript
// server/routes.ts

import { Router, Request, Response } from "express";
import { storage } from "./storage";
import { insertProjectSchema } from "@shared/schema";
import { tenantMiddleware } from "./middleware/tenant";

const router = Router();

// Apply tenant middleware to all routes
router.use(tenantMiddleware);

// =============================================================================
// PROJECTS (Tenant-Scoped)
// =============================================================================

// List all projects for the tenant
router.get("/api/projects", async (req: Request, res: Response) => {
  try {
    const projects = await storage.getProjectsByOrganization(
      req.tenant!.organizationId
    );
    res.json(projects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Get a single project
router.get("/api/projects/:id", async (req: Request, res: Response) => {
  try {
    const project = await storage.getProjectById(
      req.tenant!.organizationId,
      parseInt(req.params.id)
    );
    
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    res.json(project);
  } catch (error) {
    console.error("Error fetching project:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// Create a new project
router.post("/api/projects", async (req: Request, res: Response) => {
  try {
    const validated = insertProjectSchema.parse({
      ...req.body,
      organizationId: req.tenant!.organizationId,
      createdById: req.tenant!.user.id,
    });
    
    const project = await storage.createProject(
      req.tenant!.organizationId,
      validated
    );
    
    // Audit log
    await storage.createAuditLog({
      organizationId: req.tenant!.organizationId,
      userId: req.tenant!.user.id,
      action: "CREATE",
      resource: "projects",
      resourceId: project.id.toString(),
      details: JSON.stringify({ name: project.name }),
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });
    
    res.status(201).json(project);
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// Update a project
router.patch("/api/projects/:id", async (req: Request, res: Response) => {
  try {
    const project = await storage.updateProject(
      req.tenant!.organizationId,
      parseInt(req.params.id),
      req.body
    );
    
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    // Audit log
    await storage.createAuditLog({
      organizationId: req.tenant!.organizationId,
      userId: req.tenant!.user.id,
      action: "UPDATE",
      resource: "projects",
      resourceId: project.id.toString(),
      details: JSON.stringify(req.body),
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });
    
    res.json(project);
  } catch (error) {
    console.error("Error updating project:", error);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// Delete a project
router.delete("/api/projects/:id", async (req: Request, res: Response) => {
  try {
    const success = await storage.deleteProject(
      req.tenant!.organizationId,
      parseInt(req.params.id)
    );
    
    if (!success) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    // Audit log
    await storage.createAuditLog({
      organizationId: req.tenant!.organizationId,
      userId: req.tenant!.user.id,
      action: "DELETE",
      resource: "projects",
      resourceId: req.params.id,
      details: null,
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });
    
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// =============================================================================
// USERS (Tenant-Scoped)
// =============================================================================

router.get("/api/users", async (req: Request, res: Response) => {
  try {
    // Only org admins and above can list users
    if (!["super_admin", "org_admin"].includes(req.tenant!.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    
    const users = await storage.getUsersByOrganization(
      req.tenant!.organizationId
    );
    
    // Remove password hashes from response
    const safeUsers = users.map(({ passwordHash, ...user }) => user);
    
    res.json(safeUsers);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// =============================================================================
// AUDIT LOGS (Tenant-Scoped)
// =============================================================================

router.get("/api/audit-logs", async (req: Request, res: Response) => {
  try {
    // Only admins can view audit logs
    if (!["super_admin", "org_admin"].includes(req.tenant!.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = await storage.getAuditLogs(req.tenant!.organizationId, limit);
    
    res.json(logs);
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

export default router;
```

---

## Role-Based Access Control (RBAC)

### Permission Middleware

```typescript
// server/middleware/rbac.ts

import { Request, Response, NextFunction } from "express";

type Role = "super_admin" | "org_admin" | "manager" | "user" | "viewer";

interface Permission {
  resource: string;
  actions: string[];
}

const rolePermissions: Record<Role, Permission[]> = {
  super_admin: [
    { resource: "*", actions: ["*"] },
  ],
  org_admin: [
    { resource: "users", actions: ["create", "read", "update", "delete"] },
    { resource: "projects", actions: ["create", "read", "update", "delete"] },
    { resource: "settings", actions: ["read", "update"] },
    { resource: "audit_logs", actions: ["read"] },
  ],
  manager: [
    { resource: "projects", actions: ["create", "read", "update"] },
    { resource: "users", actions: ["read"] },
  ],
  user: [
    { resource: "projects", actions: ["create", "read", "update"] },
  ],
  viewer: [
    { resource: "projects", actions: ["read"] },
  ],
};

export function checkPermission(resource: string, action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenant) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userRole = req.tenant.user.role as Role;
    const permissions = rolePermissions[userRole] || [];

    const hasPermission = permissions.some(
      (p) =>
        (p.resource === "*" || p.resource === resource) &&
        (p.actions.includes("*") || p.actions.includes(action))
    );

    if (!hasPermission) {
      return res.status(403).json({ 
        error: "Forbidden",
        message: `You don't have permission to ${action} ${resource}`
      });
    }

    next();
  };
}

// Usage in routes:
// router.post("/api/users", checkPermission("users", "create"), createUserHandler);
// router.delete("/api/users/:id", checkPermission("users", "delete"), deleteUserHandler);
```

---

## Testing Multi-Tenancy

### Integration Tests

```typescript
// tests/multi-tenancy.test.ts

import request from "supertest";
import { app } from "../server";
import { db } from "../server/db";
import { organizations, users, projects } from "@shared/schema";

describe("Multi-Tenancy Isolation", () => {
  let org1Token: string;
  let org2Token: string;
  let org1ProjectId: number;

  beforeAll(async () => {
    // Create two organizations
    const [org1] = await db.insert(organizations).values({ 
      name: "Org 1", 
      slug: "org1" 
    }).returning();
    
    const [org2] = await db.insert(organizations).values({ 
      name: "Org 2", 
      slug: "org2" 
    }).returning();

    // Create users in each org
    // ... login and get tokens
  });

  it("should not allow Org 2 to access Org 1 projects", async () => {
    // Create project as Org 1
    const createRes = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${org1Token}`)
      .send({ name: "Org 1 Secret Project" });
    
    org1ProjectId = createRes.body.id;

    // Try to access as Org 2
    const accessRes = await request(app)
      .get(`/api/projects/${org1ProjectId}`)
      .set("Authorization", `Bearer ${org2Token}`);

    expect(accessRes.status).toBe(404); // Should not find it
  });

  it("should not allow Org 2 to update Org 1 projects", async () => {
    const res = await request(app)
      .patch(`/api/projects/${org1ProjectId}`)
      .set("Authorization", `Bearer ${org2Token}`)
      .send({ name: "Hacked!" });

    expect(res.status).toBe(404);
  });

  it("should not allow Org 2 to delete Org 1 projects", async () => {
    const res = await request(app)
      .delete(`/api/projects/${org1ProjectId}`)
      .set("Authorization", `Bearer ${org2Token}`);

    expect(res.status).toBe(404);
  });

  it("should only list own organization projects", async () => {
    const res = await request(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${org2Token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0); // No projects for Org 2
  });
});
```

---

## Best Practices Summary

### DO

- Always include `organizationId` in WHERE clauses
- Use the tenant context from middleware
- Audit all data access and modifications
- Test cross-tenant isolation
- Use composite indexes on (organizationId, ...)

### DON'T

- Never trust client-provided organization IDs
- Never expose internal IDs in URLs without validation
- Never query without tenant scoping (except super admin)
- Never store sensitive data without organization association

---

*Document Version: 1.0*
*Last Updated: November 2024*
