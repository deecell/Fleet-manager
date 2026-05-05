/**
 * Admin Exports endpoints.
 *
 *   POST   /api/admin/exports             — enqueue an admin export
 *                                            (kind: 'devices' | 'historical')
 *   GET    /api/admin/exports             — list this admin user's recent jobs
 *   GET    /api/admin/exports/:id         — single-job poll target
 *   PATCH  /api/admin/exports/:id/dismiss — hide a finished job from the banner
 *
 * All routes are gated by `adminMiddleware`. Jobs are attributed to the
 * platform-admin's `users` row inside the `Deecell Internal` org so the
 * existing concurrency caps, advisory lock, and email lookup keep working.
 * The S3 key for admin jobs is `exports/admin/<jobId>/<filename>` (handled
 * in the worker).
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
import {
  HISTORICAL_MAX_RANGE_MS,
  HISTORICAL_MAX_ROWS,
  estimateHistoricalRows,
  type HistoricalGranularity,
} from "@shared/export-historical";
import { storage } from "../storage";
import { adminMiddleware } from "./admin-routes";
import { exportJobWorker } from "../services/exports/job-worker";

const router = Router();

const devicesPayload = z.object({
  kind: z.literal("devices"),
  format: z.enum(["csv", "xlsx"]),
  organizationId: z.coerce.number().int().positive().nullish(),
  searchQuery: z.string().trim().min(1).max(200).nullish(),
  // Opt-in email flag (default false). See notes on customer route.
  notifyByEmail: z.boolean().optional(),
});

const historicalPayload = z.object({
  kind: z.literal("historical"),
  format: z.enum(["csv", "xlsx"]),
  organizationId: z.coerce.number().int().positive(),
  truckId: z.coerce.number().int().positive(),
  granularity: z.enum(["minute", "hour", "day"]),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  notifyByEmail: z.boolean().optional(),
});

const createAdminExportSchema = z.discriminatedUnion("kind", [
  devicesPayload,
  historicalPayload,
]);

const ADMIN_KINDS = new Set<string>([
  EXPORT_JOB_KIND.ADMIN_DEVICES,
  EXPORT_JOB_KIND.ADMIN_HISTORICAL,
]);

/**
 * Trimmed serialized shape returned to the admin client. Carries enough info
 * for the recent-exports table to label rows for both `admin_devices` and
 * `admin_historical` kinds.
 */
interface SerializedAdminExportJob {
  id: number;
  kind: string;
  /** Human-readable label rendered by the table + ExportsBanner. */
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
  historical: {
    truckId: number | null;
    truckNumber: string | null;
    granularity: HistoricalGranularity | null;
    startTime: Date | null;
    endTime: Date | null;
  } | null;
  notifiedAt: Date | null;
  dismissedAt: Date | null;
  requestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

function intervalSecondsToGranularity(s: number | null): HistoricalGranularity | null {
  if (s === 60) return "minute";
  if (s === 3600) return "hour";
  if (s === 86400) return "day";
  return null;
}

function granularityToIntervalSeconds(g: HistoricalGranularity): number {
  if (g === "hour") return 3600;
  if (g === "day") return 86400;
  return 60;
}

function buildAdminBundleLabel(job: ExportJob, filters: {
  organizationName?: string | null;
  searchQuery?: string | null;
  truckNumber?: string | null;
}): string {
  if (job.kind === EXPORT_JOB_KIND.ADMIN_HISTORICAL) {
    const parts: string[] = ["Admin Truck History"];
    if (filters.organizationName) parts.push(filters.organizationName);
    if (filters.truckNumber) parts.push(`Truck ${filters.truckNumber}`);
    const g = intervalSecondsToGranularity(job.historicalIntervalSeconds);
    if (g) parts.push(g === "minute" ? "Per minute" : g === "hour" ? "Hourly" : "Daily");
    return parts.join(" — ");
  }
  const parts: string[] = ["Admin Devices"];
  parts.push(filters.organizationName ?? "All organizations");
  if (filters.searchQuery) parts.push(`"${filters.searchQuery}"`);
  return parts.join(" — ");
}

function serializeAdminJob(job: ExportJob): SerializedAdminExportJob {
  const filters = (job.filters as
    | {
        organizationId?: number | null;
        organizationName?: string | null;
        searchQuery?: string | null;
        truckNumber?: string | null;
      }
    | null) ?? {};
  const isHistorical = job.kind === EXPORT_JOB_KIND.ADMIN_HISTORICAL;
  return {
    id: job.id,
    kind: job.kind ?? EXPORT_JOB_KIND.ADMIN_DEVICES,
    bundleLabel: buildAdminBundleLabel(job, filters),
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
    historical: isHistorical
      ? {
          truckId: job.historicalTruckId,
          truckNumber: filters.truckNumber ?? null,
          granularity: intervalSecondsToGranularity(job.historicalIntervalSeconds),
          startTime: job.historicalStartTime,
          endTime: job.historicalEndTime,
        }
      : null,
    notifiedAt: job.notifiedAt,
    dismissedAt: job.dismissedAt,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

function getAdminIds(req: Request): { userId: number; organizationId: number } | null {
  const userId = req.userId ?? req.session?.userId;
  const organizationId = req.organizationId ?? req.session?.organizationId;
  if (!userId || !organizationId) return null;
  return { userId, organizationId };
}

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

  if (input.kind === "devices") {
    let organizationName: string | null = null;
    if (input.organizationId != null) {
      const org = await storage.getOrganization(input.organizationId);
      if (!org) return res.status(404).json({ error: "Organization not found" });
      organizationName = org.name;
    }

    const result = await storage.createExportJobWithLimits(
      {
        organizationId: ids.organizationId,
        userId: ids.userId,
        kind: EXPORT_JOB_KIND.ADMIN_DEVICES,
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
        notifyByEmail: input.notifyByEmail ?? false,
      },
      {
        userLimit: EXPORT_USER_CONCURRENCY_LIMIT,
        orgLimit: EXPORT_ORG_CONCURRENCY_LIMIT,
      },
    );

    if (!result.ok) return respondLimit(res, result);
    exportJobWorker.nudge();
    return res.status(202).json({ job: serializeAdminJob(result.job) });
  }

  // ---- historical ----
  const startTime = new Date(input.startTime);
  const endTime = new Date(input.endTime);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return res.status(400).json({ error: "Invalid startTime or endTime" });
  }
  if (endTime.getTime() <= startTime.getTime()) {
    return res.status(400).json({ error: "endTime must be after startTime" });
  }
  const rangeMs = endTime.getTime() - startTime.getTime();
  if (rangeMs > HISTORICAL_MAX_RANGE_MS) {
    return res.status(400).json({ error: "Date range exceeds 1 year maximum" });
  }
  const estimate = estimateHistoricalRows({
    startMs: startTime.getTime(),
    endMs: endTime.getTime(),
    granularity: input.granularity,
  });
  if (estimate.exceedsMaxRows) {
    return res.status(400).json({
      error: `Estimated ${estimate.rowCount.toLocaleString()} rows exceeds the ${HISTORICAL_MAX_ROWS.toLocaleString()} row cap. Choose a coarser granularity or a shorter range.`,
    });
  }

  const org = await storage.getOrganization(input.organizationId);
  if (!org) return res.status(404).json({ error: "Organization not found" });

  const truck = await storage.getTruck(input.organizationId, input.truckId);
  if (!truck) {
    return res.status(404).json({
      error: "Truck not found in the selected organization",
    });
  }

  const result = await storage.createExportJobWithLimits(
    {
      organizationId: ids.organizationId,
      userId: ids.userId,
      kind: EXPORT_JOB_KIND.ADMIN_HISTORICAL,
      bundleKey: "admin_historical",
      format: input.format,
      filters: {
        organizationId: input.organizationId,
        organizationName: org.name,
        truckNumber: truck.truckNumber ?? null,
        searchQuery: null,
      },
      includeColumns: null,
      excludeColumns: null,
      historicalMode: true,
      historicalTruckId: input.truckId,
      historicalStartTime: startTime,
      historicalEndTime: endTime,
      historicalIntervalSeconds: granularityToIntervalSeconds(input.granularity),
      notifyByEmail: input.notifyByEmail ?? false,
    },
    {
      userLimit: EXPORT_USER_CONCURRENCY_LIMIT,
      orgLimit: EXPORT_ORG_CONCURRENCY_LIMIT,
    },
  );

  if (!result.ok) return respondLimit(res, result);
  exportJobWorker.nudge();
  return res.status(202).json({ job: serializeAdminJob(result.job) });
});

function respondLimit(
  res: Response,
  result: {
    ok: false;
    reason: "user_limit" | "org_limit";
    activeUserCount?: number;
    activeOrgCount?: number;
  },
) {
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
  const adminJobs = jobs.filter((j) => ADMIN_KINDS.has(j.kind ?? ""));
  return res.json({ jobs: adminJobs.map(serializeAdminJob) });
});

router.get("/:id", adminMiddleware, async (req: Request, res: Response) => {
  const ids = getAdminIds(req);
  if (!ids) return res.status(500).json({ error: "Admin identity not provisioned" });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid job id" });
  const job = await storage.getExportJob(ids.organizationId, id);
  if (!job || job.userId !== ids.userId || !ADMIN_KINDS.has(job.kind ?? "")) {
    return res.status(404).json({ error: "Export job not found" });
  }
  return res.json({ job: serializeAdminJob(job) });
});

router.patch("/:id/dismiss", adminMiddleware, async (req: Request, res: Response) => {
  const ids = getAdminIds(req);
  if (!ids) return res.status(500).json({ error: "Admin identity not provisioned" });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid job id" });
  const existing = await storage.getExportJob(ids.organizationId, id);
  if (!existing || existing.userId !== ids.userId || !ADMIN_KINDS.has(existing.kind ?? "")) {
    return res.status(404).json({ error: "Export job not found" });
  }
  const job = await storage.dismissExportJob(ids.organizationId, ids.userId, id);
  if (!job) return res.status(404).json({ error: "Export job not found" });
  return res.json({ job: serializeAdminJob(job) });
});

export default router;
