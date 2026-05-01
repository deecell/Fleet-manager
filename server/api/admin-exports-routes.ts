/**
 * Admin Devices Export endpoints (Task #5 — soft launch).
 *
 *   POST   /api/admin/exports             — enqueue an admin device export
 *   GET    /api/admin/exports             — list this admin user's recent jobs
 *   GET    /api/admin/exports/:id         — single-job poll target
 *   PATCH  /api/admin/exports/:id/dismiss — hide a finished job from the banner
 *
 * All routes are gated by `adminMiddleware`. Jobs are attributed to the
 * synthetic "Deecell Admin" user inside the "Deecell Internal" org so the
 * existing concurrency caps, advisory lock, and email lookup keep working
 * without per-admin-user changes (those land in Task #8). The S3 key for
 * admin jobs is `exports/admin/<jobId>/<filename>` (handled in the worker).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  EXPORT_JOB_KIND,
  EXPORT_JOB_STATUS,
  EXPORT_USER_CONCURRENCY_LIMIT,
  EXPORT_ORG_CONCURRENCY_LIMIT,
  type ExportJob,
} from "@shared/schema";
import { storage } from "../storage";
import { adminMiddleware } from "./admin-routes";
import { exportJobWorker } from "../services/exports/job-worker";

const router = Router();

const createAdminExportSchema = z
  .object({
    format: z.enum(["csv", "xlsx"]),
    organizationId: z.coerce.number().int().positive().nullish(),
    searchQuery: z.string().trim().min(1).max(200).nullish(),
  })
  .strict();

/**
 * Trimmed serialized shape returned to the admin client. We deliberately do
 * NOT reuse the customer `SerializedExportJob` because the admin UI does not
 * need historicalMode / bundleKey / column-count fields and surfacing them
 * would conflate the two trust boundaries on the wire.
 */
interface SerializedAdminExportJob {
  id: number;
  kind: string;
  /** Human-readable label rendered by ExportsBanner (e.g. "Admin Devices — ACME"). */
  bundleLabel: string;
  format: string;
  status: string;
  errorMessage: string | null;
  rowCount: number | null;
  fileSizeBytes: number | null;
  filename: string | null;
  downloadUrl: string | null;
  downloadUrlExpiresAt: Date | null;
  filters: {
    organizationId: number | null;
    organizationName: string | null;
    searchQuery: string | null;
  };
  notifiedAt: Date | null;
  dismissedAt: Date | null;
  requestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

function buildAdminBundleLabel(filters: {
  organizationName?: string | null;
  searchQuery?: string | null;
}): string {
  const parts: string[] = ["Admin Devices"];
  if (filters.organizationName) parts.push(filters.organizationName);
  else parts.push("All organizations");
  if (filters.searchQuery) parts.push(`"${filters.searchQuery}"`);
  return parts.join(" — ");
}

function serializeAdminJob(job: ExportJob): SerializedAdminExportJob {
  const filters = (job.filters as
    | { organizationId?: number | null; organizationName?: string | null; searchQuery?: string | null }
    | null) ?? {};
  return {
    id: job.id,
    kind: job.kind ?? EXPORT_JOB_KIND.ADMIN_DEVICES,
    bundleLabel: buildAdminBundleLabel(filters),
    format: job.format,
    status: job.status,
    errorMessage: job.errorMessage,
    rowCount: job.rowCount,
    fileSizeBytes: job.fileSizeBytes,
    filename: job.s3Filename,
    downloadUrl: job.downloadUrl,
    downloadUrlExpiresAt: job.downloadUrlExpiresAt,
    filters: {
      organizationId: filters.organizationId ?? null,
      organizationName: filters.organizationName ?? null,
      searchQuery: filters.searchQuery ?? null,
    },
    notifiedAt: job.notifiedAt,
    dismissedAt: job.dismissedAt,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

function getAdminIds(req: Request): { userId: number; organizationId: number } | null {
  // Task #8 — admin sessions now carry the actual users.id of the logged-in
  // admin instead of a synthetic shared identity. platformAdminMiddleware
  // re-validates the user every request and writes req.userId / req.orgId
  // (mirroring tenantMiddleware's contract), so we read those first and
  // fall back to the session for safety.
  const userId = req.userId ?? req.session?.userId;
  const organizationId = req.organizationId ?? req.session?.organizationId;
  if (!userId || !organizationId) return null;
  return { userId, organizationId };
}

// POST /api/admin/exports — enqueue a new admin device export.
router.post("/", adminMiddleware, async (req: Request, res: Response) => {
  const parsed = createAdminExportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }
  const ids = getAdminIds(req);
  if (!ids) {
    return res.status(500).json({
      error: "Admin identity not provisioned. Try logging out and back in.",
    });
  }

  const input = parsed.data;

  // Resolve organization name eagerly so the worker (and the eventual email)
  // can show "Org: ACME Trucking" without a second lookup at render time.
  let organizationName: string | null = null;
  if (input.organizationId != null) {
    const org = await storage.getOrganization(input.organizationId);
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }
    organizationName = org.name;
  }

  const result = await storage.createExportJobWithLimits(
    {
      organizationId: ids.organizationId,
      userId: ids.userId,
      kind: EXPORT_JOB_KIND.ADMIN_DEVICES,
      // bundleKey is a NOT NULL text column on `export_jobs`. Admin exports
      // have no bundle (the column set is fixed) so we store a stable
      // sentinel that the worker ignores when kind === 'admin_devices'.
      bundleKey: "admin_devices",
      format: input.format,
      filters: {
        organizationId: input.organizationId ?? null,
        organizationName,
        searchQuery: input.searchQuery ?? null,
      },
      includeColumns: null,
      excludeColumns: null,
      historicalMode: false,
      historicalTruckId: null,
      historicalStartTime: null,
      historicalEndTime: null,
      historicalIntervalSeconds: 60,
    },
    {
      userLimit: EXPORT_USER_CONCURRENCY_LIMIT,
      orgLimit: EXPORT_ORG_CONCURRENCY_LIMIT,
    },
  );

  if (!result.ok) {
    const message =
      result.reason === "user_limit"
        ? `You already have ${EXPORT_USER_CONCURRENCY_LIMIT} admin exports in progress — wait for one to finish.`
        : `The admin queue already has ${EXPORT_ORG_CONCURRENCY_LIMIT} exports in progress — wait for one to finish.`;
    return res.status(429).json({
      error: message,
      reason: result.reason,
      activeUserCount: result.activeUserCount,
      activeOrgCount: result.activeOrgCount,
      userLimit: EXPORT_USER_CONCURRENCY_LIMIT,
      orgLimit: EXPORT_ORG_CONCURRENCY_LIMIT,
    });
  }

  exportJobWorker.nudge();
  return res.status(202).json({ job: serializeAdminJob(result.job) });
});

// GET /api/admin/exports — list this admin's jobs.
//   ?active=true  → banner data: pending + running + completed-not-dismissed
//                   + failed-not-dismissed.
router.get("/", adminMiddleware, async (req: Request, res: Response) => {
  const ids = getAdminIds(req);
  if (!ids) return res.status(500).json({ error: "Admin identity not provisioned" });
  const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);

  let statuses: string[] | undefined;
  let includeDismissed: boolean;
  if (req.query.active === "true" || req.query.active === "1") {
    statuses = [
      EXPORT_JOB_STATUS.PENDING,
      EXPORT_JOB_STATUS.RUNNING,
      EXPORT_JOB_STATUS.COMPLETED,
      EXPORT_JOB_STATUS.FAILED,
    ];
    includeDismissed = false;
  } else {
    const statusParam = req.query.status as string | undefined;
    statuses = statusParam
      ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    includeDismissed = req.query.includeDismissed !== "false";
  }

  const jobs = await storage.listExportJobsForUser(ids.organizationId, ids.userId, {
    limit,
    statuses,
    includeDismissed,
  });
  // Defensive: only ever surface admin_devices kind through this endpoint.
  const adminJobs = jobs.filter((j) => (j.kind ?? "") === EXPORT_JOB_KIND.ADMIN_DEVICES);
  return res.json({ jobs: adminJobs.map(serializeAdminJob) });
});

router.get("/:id", adminMiddleware, async (req: Request, res: Response) => {
  const ids = getAdminIds(req);
  if (!ids) return res.status(500).json({ error: "Admin identity not provisioned" });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }
  const job = await storage.getExportJob(ids.organizationId, id);
  if (!job || job.userId !== ids.userId || job.kind !== EXPORT_JOB_KIND.ADMIN_DEVICES) {
    return res.status(404).json({ error: "Export job not found" });
  }
  return res.json({ job: serializeAdminJob(job) });
});

router.patch("/:id/dismiss", adminMiddleware, async (req: Request, res: Response) => {
  const ids = getAdminIds(req);
  if (!ids) return res.status(500).json({ error: "Admin identity not provisioned" });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }
  const existing = await storage.getExportJob(ids.organizationId, id);
  if (!existing || existing.userId !== ids.userId || existing.kind !== EXPORT_JOB_KIND.ADMIN_DEVICES) {
    return res.status(404).json({ error: "Export job not found" });
  }
  const job = await storage.dismissExportJob(ids.organizationId, ids.userId, id);
  if (!job) {
    return res.status(404).json({ error: "Export job not found" });
  }
  return res.json({ job: serializeAdminJob(job) });
});

export default router;
