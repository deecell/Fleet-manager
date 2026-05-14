import { Router, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import {
  insertOrganizationSchema,
  insertFleetSchema,
  insertTruckSchema,
  insertPowerMonDeviceSchema,
  insertUserSchema,
  insertDeviceCredentialSchema,
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcrypt";
import { getSimSyncService } from "../services/sim-sync-service";
import { createSimProClient, SimProApiError } from "../services/simpro-client";
import { db } from "../db";
import { sims, powerMonDevices, type InsertSim } from "@shared/schema";
import { eq, isNull, and as drizzleAnd } from "drizzle-orm";
import { createGitHubIssue, listGitHubIssues, getGitHubLabels } from "../services/github-issues";
import { processAdminChat, ChatMessage } from "../services/admin-assistant";
import { sendWelcomeEmail, sendInvitationEmail, isEmailConfigured } from "../services/email-service";
import { nanoid } from "nanoid";

const SALT_ROUNDS = 10;

const router = Router();

// Session shape (isPlatformAdmin, userId, organizationId, adminEmail)
// is declared in `server/types/session.d.ts` so customer + admin auth
// share one source of truth and don't drift.

// Request augmentation: platformAdminMiddleware writes the freshly-validated
// admin's identity onto req.* so downstream handlers can identify the acting
// user without re-reading the session. tenantMiddleware writes the same
// fields for customer routes, so handlers shared across both surfaces have
// a uniform identity contract.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
      organizationId?: number;
      userEmail?: string;
      userName?: string;
    }
  }
}

// Exported so admin-exports-routes (Task #5) can reuse the same auth gate.
// Renamed conceptually from adminMiddleware → platformAdminMiddleware; the
// old name is re-exported below as an alias so existing imports keep working
// without a touch-up.
export const platformAdminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.session?.isPlatformAdmin || !req.session?.userId || !req.session?.organizationId) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Admin authentication required. Please login at /admin/login",
    });
  }
  // Defence-in-depth: re-load both the user and the organization on every
  // request so a flag flip in the DB (e.g. an admin revoking another admin's
  // access, or the deecell-internal org getting deactivated) takes effect on
  // the next request rather than waiting for the session to expire. The
  // tenant middleware does the same for customer surfaces and we mirror that
  // contract here.
  try {
    const user = await storage.getUserById(req.session.userId);
    if (!user || !user.isActive || !user.isPlatformAdmin) {
      req.session.destroy(() => {});
      return res.status(401).json({
        error: "Unauthorized",
        message: "Admin access revoked. Please login again.",
      });
    }
    const organization = await storage.getOrganization(user.organizationId);
    if (!organization || !organization.isActive) {
      req.session.destroy(() => {});
      return res.status(401).json({
        error: "Unauthorized",
        message: "Organization inactive. Please contact support.",
      });
    }
    // Re-pin canonical IDs to the freshly-loaded user so a subsequent
    // organization migration is reflected immediately.
    req.session.userId = user.id;
    req.session.organizationId = user.organizationId;
    // Expose identity on the request object so downstream handlers can
    // identify the acting admin without re-reading the session. This mirrors
    // tenantMiddleware's contract and is what admin-exports-routes consumes
    // via req.userId / req.organizationId.
    req.userId = user.id;
    req.organizationId = user.organizationId;
    req.userEmail = user.email;
    req.userName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  } catch (err) {
    console.error("[admin] Failed to re-validate platform admin:", err);
    return res.status(500).json({ error: "Auth check failed" });
  }
  next();
};

// Backward-compat alias so existing `import { adminMiddleware } from ...`
// callers (notably admin-exports-routes.ts) keep compiling.
export const adminMiddleware = platformAdminMiddleware;

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({
        error: "Missing credentials",
        message: "Email and password are required",
      });
    }

    // Platform admins live exclusively in deecell-internal. Scope the lookup
    // to that org so admin auth is deterministic even if a customer happens
    // to share an email address (the schema's UNIQUE key is (email, org_id),
    // so duplicates across orgs are valid). Bootstrap is idempotent and
    // cheap — it runs at startup but we re-call it here to defend against
    // a missing setup row in test environments.
    const { organizationId: deecellOrgId } = await storage.ensureDeecellInternalSetup();
    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await storage.getUserByEmail(deecellOrgId, normalizedEmail);

    // Use a generic error for every failure mode (no account, wrong password,
    // non-admin user) so we don't leak which emails are registered as admins.
    const genericFail = () =>
      res.status(401).json({
        error: "Invalid credentials",
        message: "Email or password is incorrect",
      });

    if (!user || !user.isActive || !user.isPlatformAdmin) {
      return genericFail();
    }

    if (!user.passwordHash) {
      return res.status(401).json({
        error: "Account not configured",
        message: "Please use 'Forgot password?' to set up your password",
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return genericFail();
    }

    const organization = await storage.getOrganization(user.organizationId);
    if (!organization || !organization.isActive) {
      return res.status(401).json({
        error: "Organization inactive",
        message: "Your organization is no longer active. Contact support.",
      });
    }

    await storage.updateUserLastLogin(user.organizationId, user.id);

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regeneration error:", err);
        return res.status(500).json({ error: "Login failed" });
      }

      req.session.isPlatformAdmin = true;
      req.session.userId = user.id;
      req.session.organizationId = user.organizationId;
      req.session.userEmail = user.email;
      req.session.userName =
        [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
      req.session.adminEmail = user.email;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("Session save error:", saveErr);
          return res.status(500).json({ error: "Login failed" });
        }
        return res.json({
          success: true,
          message: "Admin login successful",
          user: {
            id: user.id,
            email: user.email,
            name: req.session.userName,
          },
        });
      });
    });
  } catch (err) {
    console.error("[admin] login failure:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Session destroy error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Logged out" });
  });
});

router.get("/session", (req: Request, res: Response) => {
  res.json({
    isPlatformAdmin: !!req.session?.isPlatformAdmin,
    email: req.session?.userEmail ?? req.session?.adminEmail ?? null,
    name: req.session?.userName ?? null,
    // Backward-compat for the brief window while the frontend is migrating
    // off the old `isAdmin` flag — safe to remove after the new client ships.
    isAdmin: !!req.session?.isPlatformAdmin,
  });
});

router.get("/organizations", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const organizations = await storage.listOrganizations();
    res.json({ organizations });
  } catch (error) {
    console.error("Error listing organizations:", error);
    res.status(500).json({ error: "Failed to list organizations" });
  }
});

router.get("/organizations/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const organization = await storage.getOrganization(id);
    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }
    res.json({ organization });
  } catch (error) {
    console.error("Error getting organization:", error);
    res.status(500).json({ error: "Failed to get organization" });
  }
});

router.post("/organizations", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const data = insertOrganizationSchema.parse(req.body);
    const organization = await storage.createOrganization(data);
    res.status(201).json({ organization });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating organization:", error);
    res.status(500).json({ error: "Failed to create organization" });
  }
});

router.patch("/organizations/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = insertOrganizationSchema.partial().parse(req.body);
    const organization = await storage.updateOrganization(id, data);
    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }
    res.json({ organization });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating organization:", error);
    res.status(500).json({ error: "Failed to update organization" });
  }
});

router.delete("/organizations/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await storage.deleteOrganization(id);
    if (!deleted) {
      return res.status(404).json({ error: "Organization not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting organization:", error);
    res.status(500).json({ error: "Failed to delete organization" });
  }
});

router.get("/organizations/:orgId/fleets", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const fleets = await storage.listFleets(orgId);
    res.json({ fleets });
  } catch (error) {
    console.error("Error listing fleets:", error);
    res.status(500).json({ error: "Failed to list fleets" });
  }
});

router.post("/organizations/:orgId/fleets", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const data = insertFleetSchema.omit({ organizationId: true }).parse(req.body);
    const fleet = await storage.createFleet({ ...data, organizationId: orgId });
    res.status(201).json({ fleet });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating fleet:", error);
    res.status(500).json({ error: "Failed to create fleet" });
  }
});

router.patch("/fleets/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const orgId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const data = insertFleetSchema.omit({ organizationId: true }).partial().parse(req.body);
    const fleet = await storage.updateFleet(orgId, id, data);
    if (!fleet) {
      return res.status(404).json({ error: "Fleet not found" });
    }
    res.json({ fleet });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating fleet:", error);
    res.status(500).json({ error: "Failed to update fleet" });
  }
});

router.delete("/fleets/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const orgId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const deleted = await storage.deleteFleet(orgId, id);
    if (!deleted) {
      return res.status(404).json({ error: "Fleet not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting fleet:", error);
    res.status(500).json({ error: "Failed to delete fleet" });
  }
});

router.get("/debug/all-trucks", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgs = await storage.listOrganizations();
    const allTrucks: any[] = [];
    
    for (const org of orgs) {
      const trucks = await storage.listTrucks(org.id);
      for (const truck of trucks) {
        allTrucks.push({
          id: truck.id,
          truckNumber: truck.truckNumber,
          organizationId: truck.organizationId,
          organizationName: org.name,
          fleetId: truck.fleetId,
          status: truck.status,
          isActive: truck.isActive,
        });
      }
    }
    
    res.json({ 
      trucks: allTrucks,
      message: "Use this to verify truck organization assignments"
    });
  } catch (error) {
    console.error("Error listing all trucks:", error);
    res.status(500).json({ error: "Failed to list all trucks" });
  }
});

router.patch("/debug/fix-truck-org", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { truckNumber, newOrganizationId, newFleetId } = req.body;
    
    if (!truckNumber || !newOrganizationId) {
      return res.status(400).json({ 
        error: "Missing required fields",
        required: { truckNumber: "string", newOrganizationId: "number", newFleetId: "number (optional)" }
      });
    }
    
    const orgs = await storage.listOrganizations();
    let foundTruck = null;
    let currentOrgName = "";
    
    for (const org of orgs) {
      const trucks = await storage.listTrucks(org.id);
      const truck = trucks.find(t => t.truckNumber === truckNumber);
      if (truck) {
        foundTruck = truck;
        currentOrgName = org.name;
        break;
      }
    }
    
    if (!foundTruck) {
      return res.status(404).json({ error: `Truck ${truckNumber} not found in any organization` });
    }
    
    const newOrg = await storage.getOrganization(newOrganizationId);
    if (!newOrg) {
      return res.status(404).json({ error: `Organization ${newOrganizationId} not found` });
    }
    
    const updateData: any = { organizationId: newOrganizationId };
    if (newFleetId !== undefined) {
      updateData.fleetId = newFleetId;
    }
    
    const updated = await storage.updateTruck(foundTruck.organizationId, foundTruck.id, updateData);
    
    res.json({
      success: true,
      message: `Truck ${truckNumber} moved from "${currentOrgName}" (org ${foundTruck.organizationId}) to "${newOrg.name}" (org ${newOrganizationId})`,
      truck: updated
    });
  } catch (error) {
    console.error("Error fixing truck org:", error);
    res.status(500).json({ error: "Failed to fix truck organization" });
  }
});

router.get("/organizations/:orgId/trucks", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const fleetId = req.query.fleetId ? parseInt(req.query.fleetId as string, 10) : undefined;
    const trucks = await storage.listTrucks(orgId, fleetId);
    res.json({ trucks });
  } catch (error) {
    console.error("Error listing trucks:", error);
    res.status(500).json({ error: "Failed to list trucks" });
  }
});

router.post("/organizations/:orgId/trucks", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const data = insertTruckSchema.omit({ organizationId: true }).parse(req.body);
    const truck = await storage.createTruck({ ...data, organizationId: orgId });
    res.status(201).json({ truck });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating truck:", error);
    res.status(500).json({ error: "Failed to create truck" });
  }
});

router.patch("/trucks/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const orgId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const data = insertTruckSchema.omit({ organizationId: true }).partial().parse(req.body);
    const truck = await storage.updateTruck(orgId, id, data);
    if (!truck) {
      return res.status(404).json({ error: "Truck not found" });
    }
    res.json({ truck });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating truck:", error);
    res.status(500).json({ error: "Failed to update truck" });
  }
});

router.delete("/trucks/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const orgId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const deleted = await storage.deleteTruck(orgId, id);
    if (!deleted) {
      return res.status(404).json({ error: "Truck not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting truck:", error);
    res.status(500).json({ error: "Failed to delete truck" });
  }
});

router.get("/organizations/:orgId/devices", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const devices = await storage.listDevicesWithSnapshots(orgId);
    res.json({ devices });
  } catch (error) {
    console.error("Error listing devices:", error);
    res.status(500).json({ error: "Failed to list devices" });
  }
});

router.get("/devices", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const devices = await storage.listAllDevicesWithSnapshots();
    res.json({ devices });
  } catch (error) {
    console.error("Error listing all devices:", error);
    res.status(500).json({ error: "Failed to list devices" });
  }
});

router.get("/trucks", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const trucks = await storage.listAllTrucks();
    res.json({ trucks });
  } catch (error) {
    console.error("Error listing all trucks:", error);
    res.status(500).json({ error: "Failed to list trucks" });
  }
});

router.post("/organizations/:orgId/devices", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const data = insertPowerMonDeviceSchema.omit({ organizationId: true }).parse(req.body);

    // Only check for duplicate serial if one is provided
    if (data.serialNumber && await storage.checkSerialExists(data.serialNumber)) {
      return res.status(409).json({ error: "Device with this serial number already exists" });
    }

    // Hard rule (Task #21): every PowerMon device must already be present in
    // Wireless Logic (SIMPro) keyed on `custom_field1 = deviceName` BEFORE
    // we'll create the device row. Reject 0/multi matches with structured
    // codes so the form can render an inline, fixable error. The device row
    // and the sims upsert are committed atomically — no half-linked state.
    if (!data.deviceName || !data.deviceName.trim()) {
      return res.status(400).json({
        code: "DEVICE_NAME_REQUIRED",
        error: "Device name is required to look up the SIM in Wireless Logic.",
      });
    }
    const deviceName = data.deviceName.trim();

    const simProClient = createSimProClient();
    if (!simProClient) {
      return res.status(503).json({
        code: "SIMPRO_NOT_CONFIGURED",
        error: "SIMPro API credentials are not configured on the server.",
      });
    }

    let lookup;
    try {
      lookup = await simProClient.getSimByDeviceName(deviceName);
    } catch (err) {
      const message = err instanceof SimProApiError
        ? `Wireless Logic API error (${err.statusCode}): ${err.message}`
        : `Wireless Logic API call failed: ${err instanceof Error ? err.message : "unknown"}`;
      console.error("[admin] SIMPro lookup failed during device registration:", err);
      return res.status(502).json({ code: "SIMPRO_LOOKUP_FAILED", error: message });
    }

    if (lookup.kind === "none") {
      return res.status(400).json({
        code: "SIM_NOT_FOUND",
        error: `No SIM found in Wireless Logic with Custom Field 1 = "${deviceName}". Add it there first, then try again.`,
      });
    }
    if (lookup.kind === "multiple") {
      return res.status(400).json({
        code: "SIM_MULTIPLE_MATCH",
        error: `Multiple SIMs (${lookup.count}) match "${deviceName}" in Wireless Logic — clean up duplicates first.`,
      });
    }

    const simProSim = lookup.sim;

    // Pre-check: refuse to silently steal a SIM that's already linked to a
    // different PowerMon device. This protects against the "operator typed
    // the wrong name and it happened to collide with another truck's ICCID"
    // case AND keeps swap-SIM behaviour out-of-scope per Task #21.
    const existingSimRows = await db
      .select({ id: sims.id, deviceId: sims.deviceId })
      .from(sims)
      .where(eq(sims.iccid, simProSim.iccid))
      .limit(1);
    const existingSim = existingSimRows[0];
    if (existingSim && existingSim.deviceId !== null) {
      // ICCID is already pointing at a real device → block. (deviceId === null
      // means the row exists from the periodic SIMPro sync but isn't yet
      // tied to a PowerMon, so it's safe to claim.)
      return res.status(409).json({
        code: "SIM_ALREADY_LINKED",
        error: `That SIM (ICCID ${simProSim.iccid}) is already linked to another device. Use the Wireless Logic console to detach it first, or pick a different device name.`,
      });
    }

    // Atomic device + sim insert/update. If anything inside fails the
    // device row rolls back so the operator can re-try cleanly.
    const result = await db.transaction(async (tx) => {
      const [device] = await tx
        .insert(powerMonDevices)
        .values({ ...data, organizationId: orgId })
        .returning();

      const simBase = {
        organizationId: orgId,
        deviceId: device.id,
        truckId: device.truckId ?? null,
        simproId: simProSim.id,
        msisdn: simProSim.msisdn,
        imsi: simProSim.imsi || null,
        eid: simProSim.eid || null,
        deviceName,
        status: simProSim.status || "unknown",
        workflowStatus: simProSim.workflow_status || null,
        ipAddress: simProSim.ip_address || null,
        isActive: true,
      };

      if (existingSim) {
        // Existing unlinked sims row from the periodic sync — claim it in
        // place. We only get here when existingSim.deviceId IS NULL (the
        // pre-check above guards the linked case).
        await tx
          .update(sims)
          .set({ ...simBase, updatedAt: new Date() })
          .where(eq(sims.id, existingSim.id));
      } else {
        await tx.insert(sims).values({ ...simBase, iccid: simProSim.iccid } satisfies InsertSim);
      }

      return device;
    });

    res.status(201).json({
      device: result,
      sim: { iccid: simProSim.iccid, msisdn: simProSim.msisdn, deviceName },
      message: `Device registered and linked to SIM (ICCID ${simProSim.iccid}, MSISDN ${simProSim.msisdn}).`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating device:", error);
    res.status(500).json({ error: "Failed to create device" });
  }
});

/**
 * Backfill SIM links for existing PowerMon devices that have no linked SIM.
 * Runs the same strict-single Wireless Logic lookup as registration.
 * Idempotent: only operates on devices with no row in `sims` referencing
 * them, never overwrites an existing link.
 */
router.post("/devices/backfill-sim-links", adminMiddleware, async (_req: Request, res: Response) => {
  try {
    const simProClient = createSimProClient();
    if (!simProClient) {
      return res.status(503).json({
        code: "SIMPRO_NOT_CONFIGURED",
        error: "SIMPro API credentials are not configured on the server.",
      });
    }

    // Devices with no `sims` row pointing at them.
    const candidates = await db
      .select({
        id: powerMonDevices.id,
        organizationId: powerMonDevices.organizationId,
        deviceName: powerMonDevices.deviceName,
        serialNumber: powerMonDevices.serialNumber,
        truckId: powerMonDevices.truckId,
      })
      .from(powerMonDevices)
      .leftJoin(sims, eq(sims.deviceId, powerMonDevices.id))
      .where(isNull(sims.id));

    const summary = {
      scanned: candidates.length,
      linked: 0,
      skipped_no_name: [] as string[],
      failed_no_match: [] as string[],
      failed_multiple_match: [] as string[],
      failed_already_linked: [] as string[],
      failed_api_error: [] as { name: string; error: string }[],
    };

    // Sequential lookups so we don't hammer Wireless Logic.
    for (const dev of candidates) {
      const label = dev.deviceName || dev.serialNumber || `device-${dev.id}`;
      if (!dev.deviceName || !dev.deviceName.trim()) {
        summary.skipped_no_name.push(label);
        continue;
      }
      const name = dev.deviceName.trim();
      let lookup;
      try {
        lookup = await simProClient.getSimByDeviceName(name);
      } catch (err) {
        summary.failed_api_error.push({
          name: label,
          error: err instanceof Error ? err.message : "unknown",
        });
        continue;
      }
      if (lookup.kind === "none") {
        summary.failed_no_match.push(label);
        continue;
      }
      if (lookup.kind === "multiple") {
        summary.failed_multiple_match.push(`${label} (${lookup.count} matches)`);
        continue;
      }

      const sp = lookup.sim;
      try {
        // Pre-check: never overwrite a SIM that's already linked to a
        // different device. The backfill must remain idempotent and safe
        // to re-run, per the task's architectural rule.
        const existingRows = await db
          .select({ id: sims.id, deviceId: sims.deviceId })
          .from(sims)
          .where(eq(sims.iccid, sp.iccid))
          .limit(1);
        const existing = existingRows[0];
        if (existing && existing.deviceId !== null && existing.deviceId !== dev.id) {
          summary.failed_already_linked.push(`${label} → ICCID ${sp.iccid} (linked to device #${existing.deviceId})`);
          continue;
        }

        const simBase = {
          organizationId: dev.organizationId,
          deviceId: dev.id,
          truckId: dev.truckId ?? null,
          simproId: sp.id,
          msisdn: sp.msisdn,
          imsi: sp.imsi || null,
          eid: sp.eid || null,
          deviceName: name,
          status: sp.status || "unknown",
          workflowStatus: sp.workflow_status || null,
          ipAddress: sp.ip_address || null,
          isActive: true,
        };

        if (existing) {
          // existing.deviceId is either null or already === dev.id (idempotent re-run)
          await db
            .update(sims)
            .set({ ...simBase, updatedAt: new Date() })
            .where(eq(sims.id, existing.id));
        } else {
          await db.insert(sims).values({ ...simBase, iccid: sp.iccid } satisfies InsertSim);
        }
        summary.linked++;
      } catch (err) {
        summary.failed_api_error.push({
          name: label,
          error: `DB upsert failed: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
    }

    res.json(summary);
  } catch (error) {
    console.error("Error in SIM backfill:", error);
    res.status(500).json({ error: "Backfill failed" });
  }
});

router.patch("/devices/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const orgId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const data = insertPowerMonDeviceSchema.omit({ organizationId: true, serialNumber: true }).partial().parse(req.body);
    const device = await storage.updateDevice(orgId, id, data);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ device });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating device:", error);
    res.status(500).json({ error: "Failed to update device" });
  }
});

router.post("/devices/:id/assign", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { truckId, organizationId } = req.body;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const device = await storage.assignDeviceToTruck(organizationId, id, truckId);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ device });
  } catch (error) {
    console.error("Error assigning device:", error);
    res.status(500).json({ error: "Failed to assign device" });
  }
});

router.post("/devices/:id/unassign", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { organizationId } = req.body;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const device = await storage.unassignDevice(organizationId, id);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ device });
  } catch (error) {
    console.error("Error unassigning device:", error);
    res.status(500).json({ error: "Failed to unassign device" });
  }
});

router.post("/devices/:id/reset-status", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await storage.resetDeviceConnectionStatus(id);
    if (!result) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ success: true, device: result });
  } catch (error) {
    console.error("Error resetting device status:", error);
    res.status(500).json({ error: "Failed to reset device status" });
  }
});

router.post("/devices/:id/set-offline", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await storage.setDeviceOffline(id);
    if (!result) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ success: true, device: result });
  } catch (error) {
    console.error("Error setting device offline:", error);
    res.status(500).json({ error: "Failed to set device offline" });
  }
});

router.delete("/devices/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const organizationId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization ID required (use ?orgId=X)" });
    }
    const deleted = await storage.deleteDevice(organizationId, id);
    if (!deleted) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting device:", error);
    res.status(500).json({ error: "Failed to delete device" });
  }
});

router.get("/devices/:id/credentials", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const organizationId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!organizationId) {
      return res.status(400).json({ error: "Organization ID required (use ?orgId=X)" });
    }
    const credential = await storage.getCredential(organizationId, deviceId);
    if (!credential) {
      return res.status(404).json({ error: "Credentials not found for this device" });
    }
    res.json({ credential });
  } catch (error) {
    console.error("Error getting device credentials:", error);
    res.status(500).json({ error: "Failed to get device credentials" });
  }
});

router.post("/devices/:id/credentials", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const { organizationId, applinkUrl, connectionKey, accessKey } = req.body;
    
    if (!organizationId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    
    if (!applinkUrl && (!connectionKey || !accessKey)) {
      return res.status(400).json({ 
        error: "Either applinkUrl OR both connectionKey and accessKey are required" 
      });
    }
    
    let finalConnectionKey = connectionKey;
    let finalAccessKey = accessKey;
    
    if (applinkUrl && (!connectionKey || !accessKey)) {
      // Try legacy powermon:// format first
      const urlMatch = applinkUrl.match(/powermon:\/\/([^@]+)@(\S+)/);
      if (urlMatch) {
        finalAccessKey = urlMatch[1];
        finalConnectionKey = urlMatch[2];
      } else if (applinkUrl.includes('applinks.thornwave.com')) {
        // Parse Thornwave applink URL format
        // Example: https://applinks.thornwave.com/?n=DCL-Moeck&s=a3a5b30ea9b3ff98&h=41&c=connectionKey&k=accessKey
        try {
          const url = new URL(applinkUrl);
          const connectionParam = url.searchParams.get('c');
          const accessParam = url.searchParams.get('k');
          if (connectionParam && accessParam) {
            finalConnectionKey = connectionParam;
            finalAccessKey = accessParam;
          } else {
            return res.status(400).json({ 
              error: "Invalid Thornwave applink URL. Missing 'c' (connection key) or 'k' (access key) parameters." 
            });
          }
        } catch (e) {
          return res.status(400).json({ 
            error: "Invalid Thornwave applink URL format." 
          });
        }
      } else {
        return res.status(400).json({ 
          error: "Invalid applinkUrl format. Expected: powermon://accessKey@connectionKey or https://applinks.thornwave.com/..." 
        });
      }
    }
    
    const existing = await storage.getCredential(organizationId, deviceId);
    if (existing) {
      return res.status(409).json({ 
        error: "Credentials already exist for this device. Use PATCH to update." 
      });
    }
    
    const credential = await storage.createCredential({
      organizationId,
      deviceId,
      connectionKey: finalConnectionKey,
      accessKey: finalAccessKey,
      applinkUrl: applinkUrl || `powermon://${finalAccessKey}@${finalConnectionKey}`,
      isActive: true,
    });
    
    res.status(201).json({ credential });
  } catch (error) {
    console.error("Error creating device credentials:", error);
    res.status(500).json({ error: "Failed to create device credentials" });
  }
});

router.patch("/devices/:id/credentials", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const deviceId = parseInt(req.params.id, 10);
    const { organizationId, applinkUrl, connectionKey, accessKey, isActive } = req.body;
    
    if (!organizationId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    
    const updateData: Record<string, unknown> = {};
    
    if (applinkUrl) {
      updateData.applinkUrl = applinkUrl;
      // Try legacy powermon:// format first
      const urlMatch = applinkUrl.match(/powermon:\/\/([^@]+)@(\S+)/);
      if (urlMatch) {
        updateData.accessKey = urlMatch[1];
        updateData.connectionKey = urlMatch[2];
      } else if (applinkUrl.includes('applinks.thornwave.com')) {
        // Parse Thornwave applink URL format
        try {
          const url = new URL(applinkUrl);
          const connectionParam = url.searchParams.get('c');
          const accessParam = url.searchParams.get('k');
          if (connectionParam && accessParam) {
            updateData.connectionKey = connectionParam;
            updateData.accessKey = accessParam;
          }
        } catch (e) {
          // If parsing fails, just store the URL as-is
        }
      }
    }
    
    if (connectionKey) updateData.connectionKey = connectionKey;
    if (accessKey) updateData.accessKey = accessKey;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    
    const credential = await storage.updateCredential(organizationId, deviceId, updateData);
    if (!credential) {
      return res.status(404).json({ error: "Credentials not found for this device" });
    }
    
    res.json({ credential });
  } catch (error) {
    console.error("Error updating device credentials:", error);
    res.status(500).json({ error: "Failed to update device credentials" });
  }
});

router.get("/organizations/:orgId/users", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const users = await storage.listUsers(orgId);
    res.json({ users });
  } catch (error) {
    console.error("Error listing users:", error);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// Platform admins (Task #8). List + invite endpoints for managing the set
// of users that can authenticate at /admin/login. We deliberately do not
// expose a "create with password" path — every new admin is invited via
// email + the existing nanoid invitation token flow so we never have to
// hand a plaintext password to the inviter.
//
// Sanitized DTO — never echo passwordHash or other sensitive User columns
// to the client. Frontend uses `hasPassword` to distinguish "Active" from
// "Pending invite" without ever seeing the bcrypt hash itself.
function toPlatformAdminDto(u: import("@shared/schema").User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    isActive: u.isActive,
    isPlatformAdmin: u.isPlatformAdmin,
    organizationId: u.organizationId,
    lastLoginAt: u.lastLoginAt,
    hasPassword: u.passwordHash !== null && u.passwordHash !== undefined && u.passwordHash !== "",
  };
}

router.get("/platform-admins", platformAdminMiddleware, async (_req: Request, res: Response) => {
  try {
    const admins = await storage.listPlatformAdmins();
    res.json({ admins: admins.map(toPlatformAdminDto) });
  } catch (error) {
    console.error("Error listing platform admins:", error);
    res.status(500).json({ error: "Failed to list platform admins" });
  }
});

router.post("/platform-admins", platformAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const inviteSchema = z.object({
      email: z.string().email(),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
    });
    const data = inviteSchema.parse(req.body ?? {});
    const email = data.email.toLowerCase().trim();

    // The seed Andy + every additional admin all live in deecell-internal so
    // listPlatformAdmins() / org-scoped lookups stay simple.
    const { organizationId } = await storage.ensureDeecellInternalSetup();

    // Scope the existence check to deecell-internal: customer orgs may
    // legitimately have a user with the same email (UNIQUE is on (email,
    // org_id)). Promote-in-place if the row exists here but lost the flag,
    // otherwise insert a fresh invited admin in deecell-internal.
    const existing = await storage.getUserByEmail(organizationId, email);
    if (existing) {
      if (!existing.isPlatformAdmin) {
        await storage.updateUser(organizationId, existing.id, { isPlatformAdmin: true });
        // Parity with the new-user invite path: if this promoted user has
        // no password yet (e.g. seeded earlier with NULL password_hash),
        // mint a fresh invitation token and email them. Without this
        // they would have to discover /forgot-password manually.
        let invitationEmailSent = false;
        if (existing.passwordHash === null && isEmailConfigured()) {
          try {
            const token = nanoid(32);
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);
            await storage.createInvitationToken({
              userId: existing.id,
              organizationId,
              token,
              expiresAt,
            });
            invitationEmailSent = await sendInvitationEmail(
              existing.email!,
              existing.firstName || existing.name || "",
              "Deecell Internal",
              token,
            );
          } catch (emailError) {
            console.error(
              `Failed to send promoted-admin invitation to ${existing.email}:`,
              emailError,
            );
          }
        }
        return res.json({
          user: toPlatformAdminDto({ ...existing, isPlatformAdmin: true }),
          alreadyExisted: true,
          invitationEmailSent,
        });
      }
      return res.status(409).json({
        error: "Conflict",
        message: "A platform admin with that email already exists.",
      });
    }

    const user = await storage.createUser({
      organizationId,
      email,
      firstName: data.firstName,
      lastName: data.lastName,
      name: `${data.firstName} ${data.lastName}`,
      role: "admin",
      isActive: true,
      isPlatformAdmin: true,
      passwordHash: null,
    });

    let invitationEmailSent = false;
    if (isEmailConfigured()) {
      try {
        const token = nanoid(32);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await storage.createInvitationToken({
          userId: user.id,
          organizationId,
          token,
          expiresAt,
        });

        invitationEmailSent = await sendInvitationEmail(
          user.email!,
          user.firstName || user.name || "",
          "Deecell Internal",
          token,
        );
      } catch (emailError) {
        console.error(`Failed to send admin invitation to ${user.email}:`, emailError);
      }
    }

    return res.status(201).json({ user: toPlatformAdminDto(user), invitationEmailSent });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error inviting platform admin:", error);
    res.status(500).json({ error: "Failed to invite platform admin" });
  }
});

router.delete("/platform-admins/:id", platformAdminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (id === req.session.userId) {
      // Block self-revocation so an admin can't accidentally lock the entire
      // org out by demoting themselves while alone.
      return res.status(400).json({
        error: "Cannot revoke your own admin access",
      });
    }
    const target = await storage.getUserById(id);
    if (!target || !target.isPlatformAdmin) {
      return res.status(404).json({ error: "Platform admin not found" });
    }
    await storage.updateUser(target.organizationId, target.id, { isPlatformAdmin: false });
    res.json({ success: true });
  } catch (error) {
    console.error("Error revoking platform admin:", error);
    res.status(500).json({ error: "Failed to revoke platform admin" });
  }
});

router.get("/users", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const users = await storage.listAllUsers();
    res.json({ users });
  } catch (error) {
    console.error("Error listing all users:", error);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// =============================================================================
// RESEND INVITATION
// Lets a platform admin re-mint and re-send the 7-day invitation email for
// any user that was invited but never set a password. Reuses the same
// invitation_tokens table + sendInvitationEmail() pipeline as the original
// create-user flow, so no schema migration is required. Old (now superseded)
// tokens stay in the table — the /accept-invitation route already filters by
// `expiresAt > now() AND usedAt IS NULL` so they're harmless.
//
// A 60-second in-memory cooldown per user_id prevents accidental email
// flooding when an admin double-clicks. The cooldown is process-local;
// good enough for a single-Fargate-task deployment, and a noisy second
// click just gets a 429 (it doesn't actually email twice).
// =============================================================================

const RESEND_COOLDOWN_MS = 60_000;
const lastResendByUserId = new Map<number, number>();

function checkResendCooldown(userId: number): number | null {
  const last = lastResendByUserId.get(userId);
  if (last === undefined) return null;
  const elapsed = Date.now() - last;
  if (elapsed >= RESEND_COOLDOWN_MS) return null;
  return Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
}

async function mintAndSendInvitation(
  user: { id: number; email: string | null; firstName: string | null; name: string | null; organizationId: number },
  organizationName: string,
): Promise<{ invitationEmailSent: boolean; expiresAt: Date }> {
  const token = nanoid(32);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await storage.createInvitationToken({
    userId: user.id,
    organizationId: user.organizationId,
    token,
    expiresAt,
  });
  const invitationEmailSent = await sendInvitationEmail(
    user.email!,
    user.firstName || user.name || "",
    organizationName,
    token,
  );
  lastResendByUserId.set(user.id, Date.now());
  return { invitationEmailSent, expiresAt };
}

router.post(
  "/organizations/:orgId/users/:userId/resend-invitation",
  adminMiddleware,
  async (req: Request, res: Response) => {
    try {
      const orgId = parseInt(req.params.orgId, 10);
      const userId = parseInt(req.params.userId, 10);
      if (Number.isNaN(orgId) || Number.isNaN(userId)) {
        return res.status(400).json({ error: "Invalid id" });
      }

      const user = await storage.getUser(orgId, userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!user.email) {
        return res.status(400).json({ error: "User has no email address on file" });
      }
      if (user.passwordHash) {
        return res.status(400).json({
          error:
            "User has already accepted their invitation. Use 'Reset password' to send a password-reset link instead.",
        });
      }
      if (!isEmailConfigured()) {
        return res.status(503).json({ error: "Email is not configured on this server" });
      }

      const cooldownRemaining = checkResendCooldown(user.id);
      if (cooldownRemaining !== null) {
        return res.status(429).json({
          error: `Please wait ${cooldownRemaining}s before resending another invitation to this user.`,
        });
      }

      const org = await storage.getOrganization(orgId);
      const orgName = org?.name || "your organization";
      const { invitationEmailSent, expiresAt } = await mintAndSendInvitation(user, orgName);
      if (!invitationEmailSent) {
        // Roll the cooldown back so the admin can immediately retry.
        lastResendByUserId.delete(user.id);
        return res.status(502).json({
          error:
            "Email provider rejected the request. Check the server logs and try again.",
        });
      }
      console.log(`Resent invitation email to ${user.email} (user ${user.id}, org ${orgId})`);
      return res.json({ invitationEmailSent: true, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      console.error("Error resending user invitation:", error);
      res.status(500).json({ error: "Failed to resend invitation" });
    }
  },
);

router.post(
  "/platform-admins/:id/resend-invitation",
  platformAdminMiddleware,
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Invalid id" });
      }
      const target = await storage.getUserById(id);
      if (!target || !target.isPlatformAdmin) {
        return res.status(404).json({ error: "Platform admin not found" });
      }
      if (!target.email) {
        return res.status(400).json({ error: "Admin has no email address on file" });
      }
      if (target.passwordHash) {
        return res.status(400).json({
          error:
            "Admin has already accepted their invitation. They can use 'Forgot password' on the login page instead.",
        });
      }
      if (!isEmailConfigured()) {
        return res.status(503).json({ error: "Email is not configured on this server" });
      }
      const cooldownRemaining = checkResendCooldown(target.id);
      if (cooldownRemaining !== null) {
        return res.status(429).json({
          error: `Please wait ${cooldownRemaining}s before resending another invitation to this admin.`,
        });
      }

      const { invitationEmailSent, expiresAt } = await mintAndSendInvitation(
        target,
        "Deecell Internal",
      );
      if (!invitationEmailSent) {
        lastResendByUserId.delete(target.id);
        return res.status(502).json({
          error: "Email provider rejected the request. Check the server logs and try again.",
        });
      }
      console.log(`Resent platform-admin invitation email to ${target.email} (user ${target.id})`);
      return res.json({ invitationEmailSent: true, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      console.error("Error resending platform-admin invitation:", error);
      res.status(500).json({ error: "Failed to resend invitation" });
    }
  },
);

router.post("/organizations/:orgId/users", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const sendWelcomeQuery = req.query.sendWelcome === "true";
    const sendInvitationQuery = req.query.sendInvitation === "true";
    const { password, sendWelcome: sendWelcomeBody, sendInvitation: sendInvitationBody, ...restBody } = req.body;
    const sendWelcome = sendWelcomeQuery || sendWelcomeBody === true;
    const sendInvitation = sendInvitationQuery || sendInvitationBody === true;
    const data = insertUserSchema.omit({ organizationId: true }).parse(restBody);
    
    // If sending invitation, password is not required - user will create their own
    if (!sendInvitation) {
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: [{ field: "password", message: "Password is required and must be at least 6 characters" }] 
        });
      }
    }
    
    const passwordHash = sendInvitation ? null : await bcrypt.hash(password, SALT_ROUNDS);
    
    const user = await storage.createUser({ 
      ...data, 
      organizationId: orgId,
      passwordHash 
    });

    let welcomeEmailSent = false;
    let invitationEmailSent = false;

    // Send invitation email with link to create password
    if (sendInvitation && isEmailConfigured() && user.email) {
      try {
        // Get organization name for the email
        const org = await storage.getOrganization(orgId);
        const orgName = org?.name || "your organization";
        
        // Generate invitation token (expires in 7 days)
        const token = nanoid(32);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        
        await storage.createInvitationToken({
          userId: user.id,
          organizationId: orgId,
          token,
          expiresAt,
        });
        
        invitationEmailSent = await sendInvitationEmail(
          user.email,
          user.firstName || user.name || "",
          orgName,
          token
        );
        if (invitationEmailSent) {
          console.log(`Invitation email sent to ${user.email}`);
        } else {
          console.error(`Invitation email failed for ${user.email} (sendInvitationEmail returned false)`);
        }
      } catch (emailError) {
        console.error(`Failed to send invitation email to ${user.email}:`, emailError);
      }
    }
    // Send welcome email with temporary password (legacy flow)
    else if (sendWelcome && isEmailConfigured() && user.email) {
      try {
        await sendWelcomeEmail(user.email, user.firstName || undefined, password);
        welcomeEmailSent = true;
        console.log(`Welcome email sent to ${user.email}`);
      } catch (emailError) {
        console.error(`Failed to send welcome email to ${user.email}:`, emailError);
      }
    }

    res.status(201).json({ user, welcomeEmailSent, invitationEmailSent });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.patch("/users/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const orgId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const { password, ...restBody } = req.body;
    const data = insertUserSchema.omit({ organizationId: true }).partial().parse(restBody);
    
    let updateData = { ...data };
    
    if (password && typeof password === "string" && password.trim().length > 0) {
      if (password.length < 6) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: [{ field: "password", message: "Password must be at least 6 characters" }] 
        });
      }
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      updateData = { ...updateData, passwordHash };
    }
    
    const user = await storage.updateUser(orgId, id, updateData);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.delete("/users/:id", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const orgId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    const deleted = await storage.deleteUser(orgId, id);
    if (!deleted) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

router.patch("/users/:id/assign-truck", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const orgId = req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }
    
    const { truckId } = req.body;
    
    if (truckId !== null && truckId !== undefined) {
      const truck = await storage.getTruck(orgId, truckId);
      if (!truck) {
        return res.status(404).json({ error: "Truck not found" });
      }
    }
    
    const user = await storage.updateUser(orgId, id, { assignedTruckId: truckId ?? null });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    console.error("Error assigning truck to user:", error);
    res.status(500).json({ error: "Failed to assign truck" });
  }
});

router.get("/stats", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const stats = await storage.getAdminStats();
    res.json({ stats });
  } catch (error) {
    console.error("Error getting admin stats:", error);
    res.status(500).json({ error: "Failed to get admin stats" });
  }
});

// =============================================================================
// SIM MANAGEMENT ENDPOINTS
// =============================================================================

router.get("/simpro/status", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const simService = getSimSyncService();
    const isConfigured = simService.isConfigured();
    let isConnected = false;
    
    if (isConfigured) {
      isConnected = await simService.testConnection();
    }
    
    res.json({
      configured: isConfigured,
      connected: isConnected,
      message: isConfigured 
        ? (isConnected ? "SIMPro API connected successfully" : "SIMPro API connection failed")
        : "SIMPro API credentials not configured. Set SIMPRO_API_CLIENT and SIMPRO_API_KEY environment variables."
    });
  } catch (error) {
    console.error("Error checking SIMPro status:", error);
    res.status(500).json({ error: "Failed to check SIMPro status" });
  }
});

// Test the new usage-location endpoint recommended by Wireless Logic
router.get("/simpro/test-usage-location", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const simService = getSimSyncService();
    
    if (!simService.isConfigured()) {
      return res.status(503).json({
        error: "SIMPro not configured",
        message: "Set SIMPRO_API_CLIENT and SIMPRO_API_KEY environment variables."
      });
    }
    
    // Get optional ICCIDs from query param
    const iccidsParam = req.query.iccids as string | undefined;
    const iccids = iccidsParam ? iccidsParam.split(',') : undefined;
    
    const result = await simService.testUsageLocationEndpoint(iccids);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("Error testing usage-location endpoint:", error);
    res.status(500).json({ 
      error: "Failed to test usage-location endpoint",
      details: error.message,
      response: error.response
    });
  }
});

router.post("/organizations/:orgId/sims/sync-locations", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const simService = getSimSyncService();
    
    if (!simService.isConfigured()) {
      return res.status(503).json({
        error: "SIMPro not configured",
        message: "Set SIMPRO_API_CLIENT and SIMPRO_API_KEY environment variables."
      });
    }
    
    const result = await simService.syncLocations(orgId);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error syncing SIM locations:", error);
    res.status(500).json({ error: "Failed to sync SIM locations" });
  }
});

router.post("/organizations/:orgId/sims/sync-usage", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const simService = getSimSyncService();
    
    if (!simService.isConfigured()) {
      return res.status(503).json({
        error: "SIMPro not configured",
        message: "Set SIMPRO_API_CLIENT and SIMPRO_API_KEY environment variables."
      });
    }
    
    const result = await simService.syncUsage(orgId);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error syncing SIM usage:", error);
    res.status(500).json({ error: "Failed to sync SIM usage" });
  }
});

router.get("/organizations/:orgId/sims", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    const simService = getSimSyncService();
    const sims = await simService.getSimsForOrganization(orgId);
    res.json({ sims });
  } catch (error) {
    console.error("Error listing SIMs:", error);
    res.status(500).json({ error: "Failed to list SIMs" });
  }
});

router.get("/sims/:simId/location-history", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const simId = parseInt(req.params.simId, 10);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const simService = getSimSyncService();
    const history = await simService.getLocationHistory(simId, limit);
    res.json({ history });
  } catch (error) {
    console.error("Error getting location history:", error);
    res.status(500).json({ error: "Failed to get location history" });
  }
});

// GitHub Issues endpoints
router.get("/github/issues", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const state = (req.query.state as 'open' | 'closed' | 'all') || 'open';
    const issues = await listGitHubIssues(state);
    res.json({ issues });
  } catch (error: any) {
    console.error("Error listing GitHub issues:", error);
    res.status(500).json({ error: error.message || "Failed to list GitHub issues" });
  }
});

router.get("/github/labels", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const labels = await getGitHubLabels();
    res.json({ labels });
  } catch (error: any) {
    console.error("Error listing GitHub labels:", error);
    res.status(500).json({ error: error.message || "Failed to list GitHub labels" });
  }
});

router.post("/github/issues", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { title, body, labels } = req.body;
    
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: "Title is required" });
    }
    
    const issue = await createGitHubIssue({
      title: title.trim(),
      body: body || '',
      labels: labels || [],
    });
    
    res.json({ 
      success: true, 
      issue: {
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
      }
    });
  } catch (error: any) {
    console.error("Error creating GitHub issue:", error);
    res.status(500).json({ error: error.message || "Failed to create GitHub issue" });
  }
});

const adminChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string()
  }))
});

router.post("/assistant/chat", adminMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = adminChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error });
    }

    const { messages } = parsed.data;
    console.log(`[AdminAssistant] Processing admin chat, ${messages.length} messages`);

    const response = await processAdminChat(messages as ChatMessage[]);

    return res.json({ 
      response,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[AdminAssistant] Chat error:", error);
    return res.status(500).json({ error: "Failed to process admin chat request" });
  }
});

export default router;
