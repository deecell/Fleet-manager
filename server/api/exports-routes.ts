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
  HISTORICAL_GRANULARITIES,
  HISTORICAL_GRANULARITY_META,
  HISTORICAL_MAX_RANGE_MS,
  HISTORICAL_MAX_ROWS,
  estimateHistoricalRows,
  type HistoricalGranularity,
} from "@shared/export-historical";
import {
  EXPORT_JOB_STATUS,
  EXPORT_USER_CONCURRENCY_LIMIT,
  EXPORT_ORG_CONCURRENCY_LIMIT,
  type ExportJob,
} from "@shared/schema";
import { storage } from "../storage";
import { tenantMiddleware } from "../middleware/tenant";
import { exportJobWorker } from "../services/exports/job-worker";

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

    // Historical mode (Task #4 — single-truck time-series)
    historicalMode: z.boolean().optional(),
    historicalTruckId: z.coerce.number().int().positive().optional(),
    historicalStartTime: z.coerce.date().optional(),
    historicalEndTime: z.coerce.date().optional(),
    // Granularity is the user-facing API surface; the worker persists the
    // matching `historicalIntervalSeconds` value (60 / 3600 / 86400). We
    // accept the enum here so the client and the column registry agree.
    historicalGranularity: z.enum(HISTORICAL_GRANULARITIES as [HistoricalGranularity, ...HistoricalGranularity[]]).optional(),
    // Opt-in email flag. Default false — the recent-exports surface +
    // ExportsBanner are the primary notification channels; users can tick
    // "Email me when ready" on the export form to additionally receive a
    // SendGrid email when the job finishes (or fails).
    notifyByEmail: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.bundleKey in EXPORT_BUNDLES, {
    path: ["bundleKey"],
    message: "Unknown bundleKey",
  });

// Common shape returned to the client. Strips `s3Key` (internal), keeps
// `downloadUrl` (which is a signed URL the client can hand straight to the
// browser). Renames `s3Filename` → `filename` and adds the human bundle label.
export interface SerializedExportJob {
  id: number;
  organizationId: number;
  userId: number;
  bundleKey: string;
  bundleLabel: string;
  format: string;
  status: string;
  errorMessage: string | null;
  rowCount: number | null;
  columnCount: number | null;
  fileSizeBytes: number | null;
  filename: string | null;
  downloadUrl: string | null;
  downloadUrlExpiresAt: Date | null;
  historicalMode: boolean | null;
  historicalTruckId: number | null;
  historicalStartTime: Date | null;
  historicalEndTime: Date | null;
  historicalIntervalSeconds: number | null;
  notifiedAt: Date | null;
  dismissedAt: Date | null;
  requestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function serializeJob(job: ExportJob): SerializedExportJob {
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

  // Historical-mode validation (server-side; UI also blocks). Returns the
  // resolved interval-seconds so we don't repeat the granularity → seconds
  // map in two places.
  let historicalIntervalSeconds = 60;
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
    if (input.historicalEndTime.getTime() - input.historicalStartTime.getTime() > HISTORICAL_MAX_RANGE_MS) {
      return res.status(400).json({ error: "Historical exports are limited to 1 year" });
    }

    const granularity: HistoricalGranularity = input.historicalGranularity ?? "minute";
    historicalIntervalSeconds = HISTORICAL_GRANULARITY_META[granularity].bucketSeconds;

    // Reject anything that would obviously blow past the HISTORICAL_MAX_ROWS
    // hard cap (currently 600k) BEFORE we enqueue the job. The estimator
    // slightly over-counts on sparse data (which is fine — better to err on
    // the side of returning a 400 with a clear "pick a coarser granularity"
    // message than to let the worker spend minutes generating a huge file
    // we'd refuse to send).
    const estimate = estimateHistoricalRows({
      granularity,
      startMs: input.historicalStartTime.getTime(),
      endMs: input.historicalEndTime.getTime(),
    });
    if (estimate.exceedsMaxRows) {
      return res.status(400).json({
        error: `Estimated ${estimate.rowCount.toLocaleString()} rows exceeds the ${HISTORICAL_MAX_ROWS.toLocaleString()}-row limit. Try a shorter range or a coarser granularity.`,
        estimatedRowCount: estimate.rowCount,
        maxRows: HISTORICAL_MAX_ROWS,
      });
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
      filters: input.filters ?? null,
      includeColumns: input.includeColumns ?? null,
      excludeColumns: input.excludeColumns ?? null,
      historicalMode: input.historicalMode ?? false,
      historicalTruckId: input.historicalTruckId ?? null,
      historicalStartTime: input.historicalStartTime ?? null,
      historicalEndTime: input.historicalEndTime ?? null,
      historicalIntervalSeconds,
      notifyByEmail: input.notifyByEmail ?? false,
    },
    {
      userLimit: EXPORT_USER_CONCURRENCY_LIMIT,
      orgLimit: EXPORT_ORG_CONCURRENCY_LIMIT,
    },
  );

  if (!result.ok) {
    // Plain-English copy that the Task #3 dialog will surface inline.
    const message =
      result.reason === "user_limit"
        ? `You already have ${EXPORT_USER_CONCURRENCY_LIMIT} exports in progress — wait for one to finish.`
        : `Your organization already has ${EXPORT_ORG_CONCURRENCY_LIMIT} exports in progress — wait for one to finish.`;
    return res.status(429).json({
      error: message,
      reason: result.reason,
      activeUserCount: result.activeUserCount,
      activeOrgCount: result.activeOrgCount,
      userLimit: EXPORT_USER_CONCURRENCY_LIMIT,
      orgLimit: EXPORT_ORG_CONCURRENCY_LIMIT,
    });
  }

  // Nudge the worker so processing starts within ms instead of waiting for
  // the next 5s poll tick. Best-effort — the polling loop is the source of
  // truth and will pick the job up regardless if the nudge fails.
  exportJobWorker.nudge();

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

// GET /api/v1/exports/:id — single-job poll.
// Scoped to the requesting user as well as the org: export files contain
// only the rows the requester chose, but the signed `downloadUrl` is private
// to the requester and must not be leaked to other users in the same org.
router.get("/:id", tenantMiddleware, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }
  const job = await storage.getExportJob(req.organizationId!, id);
  if (!job || job.userId !== req.userId) {
    return res.status(404).json({ error: "Export job not found" });
  }
  return res.json({ job: serializeJob(job) });
});

// PATCH /api/v1/exports/:id/dismiss — hide the in-app banner.
// Allowed for any status (including pending/running): the user is saying "I
// don't want to watch this in the banner", not "cancel the job". The job
// keeps running and the email is still sent when it finishes; the row simply
// stops appearing in `?active=true` because it's filtered by `dismissedAt IS
// NULL`.
router.patch("/:id/dismiss", tenantMiddleware, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid job id" });
  }
  const existing = await storage.getExportJob(req.organizationId!, id);
  if (!existing || existing.userId !== req.userId) {
    return res.status(404).json({ error: "Export job not found" });
  }
  const job = await storage.dismissExportJob(req.organizationId!, req.userId!, id);
  if (!job) {
    return res.status(404).json({ error: "Export job not found" });
  }
  return res.json({ job: serializeJob(job) });
});

export default router;
