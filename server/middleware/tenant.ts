import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

declare global {
  namespace Express {
    interface Request {
      organizationId?: number;
      organizationSlug?: string;
    }
  }
}

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const orgIdHeader = req.headers["x-organization-id"];
  const orgSlugHeader = req.headers["x-organization-slug"];
  
  let organizationId: number | undefined;
  let organizationSlug: string | undefined;

  if (orgIdHeader) {
    const id = parseInt(Array.isArray(orgIdHeader) ? orgIdHeader[0] : orgIdHeader, 10);
    if (!isNaN(id)) {
      const org = await storage.getOrganization(id);
      if (org && org.isActive) {
        organizationId = org.id;
        organizationSlug = org.slug;
      }
    }
  } else if (orgSlugHeader) {
    const slug = Array.isArray(orgSlugHeader) ? orgSlugHeader[0] : orgSlugHeader;
    const org = await storage.getOrganizationBySlug(slug);
    if (org && org.isActive) {
      organizationId = org.id;
      organizationSlug = org.slug;
    }
  }

  if (!organizationId) {
    return res.status(401).json({ 
      error: "Organization context required",
      hint: "Provide X-Organization-Id or X-Organization-Slug header"
    });
  }

  req.organizationId = organizationId;
  req.organizationSlug = organizationSlug;
  next();
}

export function optionalTenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const orgIdHeader = req.headers["x-organization-id"];
  
  if (orgIdHeader) {
    const id = parseInt(Array.isArray(orgIdHeader) ? orgIdHeader[0] : orgIdHeader, 10);
    if (!isNaN(id)) {
      req.organizationId = id;
    }
  }
  
  next();
}
