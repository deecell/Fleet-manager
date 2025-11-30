import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

declare global {
  namespace Express {
    interface Request {
      organizationId?: number;
      organizationSlug?: string;
      userId?: number;
    }
  }
}

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // TODO: Re-enable authentication after design work is complete
  // Demo mode: use organization ID 1 for unauthenticated requests
  if (!req.session?.organizationId || !req.session?.userId) {
    const demoOrg = await storage.getOrganization(1);
    if (demoOrg) {
      req.organizationId = demoOrg.id;
      req.organizationSlug = demoOrg.slug;
      req.userId = 1; // Demo user ID
      return next();
    }
    return res.status(401).json({ 
      error: "Authentication required",
      message: "Please login to continue"
    });
  }

  const user = await storage.getUser(req.session.organizationId, req.session.userId);
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    return res.status(401).json({ 
      error: "Account inactive",
      message: "Your account has been deactivated. Please contact your administrator."
    });
  }

  const org = await storage.getOrganization(req.session.organizationId);
  if (!org || !org.isActive) {
    req.session.destroy(() => {});
    return res.status(401).json({ 
      error: "Organization inactive",
      message: "Your organization is no longer active. Please contact support."
    });
  }

  req.organizationId = org.id;
  req.organizationSlug = org.slug;
  req.userId = user.id;
  next();
}

export async function adminTenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const orgIdHeader = req.headers["x-organization-id"];
  const orgSlugHeader = req.headers["x-organization-slug"];
  
  let organizationId: number | undefined;
  let organizationSlug: string | undefined;

  if (orgIdHeader) {
    const id = parseInt(Array.isArray(orgIdHeader) ? orgIdHeader[0] : orgIdHeader, 10);
    if (!isNaN(id)) {
      const org = await storage.getOrganization(id);
      if (org) {
        organizationId = org.id;
        organizationSlug = org.slug;
      }
    }
  } else if (orgSlugHeader) {
    const slug = Array.isArray(orgSlugHeader) ? orgSlugHeader[0] : orgSlugHeader;
    const org = await storage.getOrganizationBySlug(slug);
    if (org) {
      organizationId = org.id;
      organizationSlug = org.slug;
    }
  }

  if (!organizationId) {
    return res.status(401).json({ 
      error: "Organization context required",
      hint: "Please provide X-Organization-Id header"
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
