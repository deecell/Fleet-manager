/**
 * Async fleet-export endpoints.
 *
 *   POST   /api/v1/exports             — enqueue a new job   → 202 | 429
 *   GET    /api/v1/exports             — list this user's recent jobs
 *   GET    /api/v1/exports/:id         — single-job status (poll target)
 *   PATCH  /api/v1/exports/:id/dismiss — mark completed-job banner dismissed
 *
 * All routes are tenant-scoped (require login). The worker (`job-worker.ts`)
 * picks pending rows up out-of-band and uploads to S3.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  EXPORT_BUNDLES,
  isColumnKey,
  type ColumnKey,
} from "@shared/export-columns";
import {
  EXPORT_JOB_STATUS,
  EXPORT_USER_CONCURRENCY_LIMIT,
  EXPORT_ORG_CONCURRENCY_LIMIT,
} from "@shared/schema";
import { storage } from "../storage";
import { tenantMiddleware } from "../middleware/tenant";

const router = Router();

const filtersSchema = z
  .object({
    fleetId: z.coerce.number().int().positive().optional(),
    operationalStatus: z.enum(["in-service", "not-in-service"]).optional(),
    searchQuery: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

// Each entry must be a known column key in the registry. Done as a custom
// refinement (not z.enum) so the error message lists the offending key(s)
// instead of the entire ~45-key enum.
const columnKeyArraySchema = z
  .array(z.string())
  .superRefine((cols, ctx) => {
    const unknown = cols.filter((c) => !isColumnKey(c));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown column key(s): ${unknown.join(", ")}`,
      });
    }
  });

const createExportJobSchema = z
  .object({
    bundleKey: z.string().min(1),
    format: z.enum(["csv", "xlsx"]),
    filters: filtersSchema.optional(),
    includeColumns: columnKeyArraySchema.optional(),
    excludeColumns: columnKeyArraySchema.optional(),

    // Historical mode (Task #4 wires this end-to-end)
    historicalMode: z.boolean().optional(),
    historicalTruckId: z.coerce.number().int().positive().optional(),
    historicalStartTime: z.coerce.date().optional(),
    historicalEndTime: z.coerce.date().optional(),
    historicalIntervalSeconds: z
      .coerce.number()
      .int()
      .min(60, "Historical interval must be at least 60 seconds (≤1 row/min)")
      .optional(),
  })
  .strict()
  .refine((v) => v.bundleKey in EXPORT_BUNDLES, {
    path: ["bundleKey"],
    message: "Unknown bundleKey",
  });

const HISTORICAL_MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// Common shape returned to the client. Strips `s3Key` (internal), keeps
// `downloadUrl` (which is a signed URL the client can hand straight to the
// browser).
function serializeJob(job: any) {
  return {
    id: job.id,
    organizationId: job.organizationId,
    userId: job.userId,
    bundleKey: job.bundleKey,
    bundleLabel:
      EXPORT_BUNDLES[job.bundleKey as keyof typeof EXPORT_BUNDLES]?.label ?? job.bundleKey,
    format: job.format,
    status: job.status,
    errorMessage: job.errorMessage,
    rowCount: job.rowCount,
    columnCount: job.columnCount,
    fileSizeBytes: job.fileSizeBytes,
    filename: job.s3Filename,
    downloadUrl: job.downloadUrl,
    downloadUrlExpiresAt: job.downloadUrlExpiresAt,
    historicalMode: job.historicalMode,
    historicalTruckId: job.historicalTruckId,
    historicalStartTime: job.historicalStartTime,
    historicalEndTime: job.historicalEndTime,
    historicalIntervalSeconds: job.historicalIntervalSeconds,
    notifiedAt: job.notifiedAt,
    dismissedAt: job.dismissedAt,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// POST /api/v1/exports — enqueue a job
router.post("/", tenantMiddleware, async (req: Request, res: Response) => {
  const parsed = createExportJobSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;

  // Historical-mode validation (server-side; UI also blocks)
  if (input.historicalMode) {
    if (!input.historicalTruckId) {
      return res.status(400).json({ error: "historicalTruckId is required when historicalMode is true" });
    }
    if (!input.historicalStartTime || !input.historicalEndTime) {
      return res.status(400).json({ error: "historicalStartTime and historicalEndTime are required when historicalMode is true" });
    }
    if (input.historicalEndTime <= input.historicalStartTime) {
      return res.status(400).json({ error: "historicalEndTime must be after historicalStartTime" });
    }
    if (input.historicalEndTime.getTime() - input.historicalStartTime.getTime() > HISTORICAL_MAX_DURATION_MS) {
      return res.status(400).json({ error: "Historical exports are limited to 1 year" });
    }
    // Confirm the truck belongs to this org.
    const truck = await storage.getTruck(req.organizationId!, input.historicalTruckId);
    if (!truck) {
      return res.status(404).json({ error: "Truck not found" });
    }
  }

  const result = await storage.createExportJobWithLimits(
    {
      organizationId: req.organizationId!,
      userId: req.userId!,
      bundleKey: input.bundleKey,
      format: input.format,
      filters: input.filters ? JSON.stringify(input.filters) : null,
      includeColumns: input.includeColumns ? JSON.stringify(input.includeColumns) : null,
      excludeColumns: input.excludeColumns ? JSON.stringify(input.excludeColumns) : null,
      historicalMode: input.historicalMode ?? false,
      historicalTruckId: input.historicalTruckId ?? null,
      historicalStartTime: input.historicalStartTime ?? null,
      historicalEndTime: input.historicalEndTime ?? null,
      historicalIntervalSeconds: input.historicalIntervalSeconds ?? 60,
    },
    {
      userLimit: EXPORT_USER_CONCURRENCY_LIMIT,
      orgLimit: EXPORT_ORG_CONCURRENCY_LIMIT,
    },
  );

  if (!result.ok) {
    return res.status(429).json({
      error: result.reason === "user_limit" ? "Too many active exports for this user" : "Too many active exports for this organization",
      reason: result.reason,
      activeUserCount: result.activeUserCount,
      activeOrgCount: result.activeOrgCount,
      userLimit: EXPORT_USER_CONCURRENCY_LIMIT,
      orgLimit: EXPORT_ORG_CONCURRENCY_LIMIT,
    });
  }

  return res.status(202).json({ job: serializeJob(result.job) });
});

// GET /api/v1/exports — list this user's recent jobs.
//
// Two modes:
//   ?active=true  — banner data: pending + running + completed-not-dismissed +
//                   failed-not-dismissed. Excludes `expired` and dismissed
//                   rows. This is what Task #3's banner polls.
//   (default)     — generic list with optional ?status= and ?includeDismissed=.
router.get("/", tenantMiddleware, async (req: Request, res: Response) => {
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

  const jobs = await storage.listExportJobsForUser(req.organizationId!, req.userId!, {
    limit,
    statuses,
    includeDismissed,
  });

  return res.json({ jobs: jobs.map(serializeJob) });
});

// GET /api/v1/exports/:id — single-job poll
router.get("/:id", tenantMiddleware, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }
  const job = await storage.getExportJob(req.organizationId!, id);
  if (!job) {
    return res.status(404).json({ error: "Export job not found" });
  }
  return res.json({ job: serializeJob(job) });
});

// PATCH /api/v1/exports/:id/dismiss — hide the in-app banner.
// Only completed/failed/expired jobs can be dismissed; pending/running jobs
// are still in flight and should remain visible until they resolve.
router.patch("/:id/dismiss", tenantMiddleware, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }
  const existing = await storage.getExportJob(req.organizationId!, id);
  if (!existing || existing.userId !== req.userId) {
    return res.status(404).json({ error: "Export job not found" });
  }
  const dismissable: string[] = [
    EXPORT_JOB_STATUS.COMPLETED,
    EXPORT_JOB_STATUS.FAILED,
    EXPORT_JOB_STATUS.EXPIRED,
  ];
  if (!dismissable.includes(existing.status)) {
    return res.status(409).json({
      error: "Only completed, failed, or expired exports can be dismissed",
      status: existing.status,
    });
  }
  const job = await storage.dismissExportJob(req.organizationId!, req.userId!, id);
  if (!job) {
    return res.status(404).json({ error: "Export job not found" });
  }
  return res.json({ job: serializeJob(job) });
});

export default router;
