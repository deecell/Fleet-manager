/**
 * Async export job worker.
 *
 * Polls the `export_jobs` table for `pending` rows, claims one at a time via
 * `FOR UPDATE SKIP LOCKED`, runs `generateExport`, uploads to S3, generates a
 * 7-day signed URL, and sends a SendGrid notification email. Failures are
 * recorded with `errorMessage` and a failure email is sent.
 *
 * Lifecycle:
 *   - `start()` is called once after the HTTP server binds (server/index.ts).
 *   - It then runs continuously in a single Node process. It is idempotent —
 *     calling `start()` again is a no-op while the worker is already running.
 *
 * Multi-instance safety: even though we currently run the worker in a single
 * web container, the claim query uses `FOR UPDATE SKIP LOCKED` so deploying
 * multiple instances behind the ALB will not double-process a job.
 */

import {
  EXPORT_BUNDLES,
  type BundleKey,
  type ColumnKey,
} from "@shared/export-columns";
import {
  EXPORT_JOB_STATUS,
  EXPORT_DOWNLOAD_TTL_SECONDS,
  type ExportJob,
} from "@shared/schema";
import { storage } from "../../storage";
import { uploadFile, getFileUrl } from "../../aws/s3";
import {
  sendExportReadyEmail,
  sendExportFailedEmail,
} from "../email-service";
import { generateExport } from "./index";
import { generateHistoricalExport } from "./historical-generator";
import {
  HISTORICAL_GRANULARITY_META,
  type HistoricalGranularity,
} from "@shared/export-historical";
import type { ExportFilters, GeneratedExport } from "./types";

const POLL_INTERVAL_MS = 5_000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — per spec

class ExportJobWorker {
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private inFlight = false; // serialize work within this process

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log("[exports/worker] started");
    // Stagger first poll slightly so startup logs stay readable.
    this.pollTimer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    // Run an immediate tick so dev iteration is snappy.
    setTimeout(() => void this.tick(), 250);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.pollTimer = null;
    this.sweepTimer = null;
    console.log("[exports/worker] stopped");
  }

  /**
   * Best-effort signal that a new pending job exists. Called by the POST
   * handler so the worker starts on the new row within milliseconds instead
   * of waiting up to a full poll interval. The polling loop remains the
   * source of truth — if nudge() runs while the worker is mid-tick, the new
   * row is picked up on the next iteration regardless.
   */
  nudge(): void {
    if (!this.running || this.inFlight) return;
    setImmediate(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (!this.running || this.inFlight) return;
    this.inFlight = true;
    try {
      // Drain up to 5 jobs per tick so a busy queue doesn't sit idle for 5s
      // between rows. Each `claimNextPendingExportJob` is its own transaction.
      for (let i = 0; i < 5; i++) {
        const job = await storage.claimNextPendingExportJob();
        if (!job) break;
        await this.processJob(job).catch((err) => {
          console.error(`[exports/worker] unhandled error processing job ${job.id}:`, err);
        });
      }
    } catch (err) {
      console.error("[exports/worker] tick error:", err);
    } finally {
      this.inFlight = false;
    }
  }

  private async sweep(): Promise<void> {
    if (!this.running) return;
    try {
      const expired = await storage.expireOverdueExportJobs();
      if (expired > 0) {
        console.log(`[exports/worker] expired ${expired} stale export job(s)`);
      }
    } catch (err) {
      console.error("[exports/worker] sweep error:", err);
    }
  }

  private async processJob(job: ExportJob): Promise<void> {
    const startedAt = Date.now();
    console.log(
      `[exports/worker] processing job ${job.id} (org=${job.organizationId}, user=${job.userId}, bundle=${job.bundleKey}, format=${job.format})`,
    );

    try {
      const format = (job.format === "xlsx" ? "xlsx" : "csv") as "csv" | "xlsx";
      let result: GeneratedExport;
      let historicalContext:
        | { granularity: HistoricalGranularity; startTime: Date; endTime: Date; truckId: number }
        | null = null;

      if (job.historicalMode) {
        // Validate the row's historical fields BEFORE invoking the generator.
        // These are persisted by the POST handler so under normal flow they're
        // guaranteed; the explicit checks here exist so a malformed row (e.g.
        // an older partial row, or a manual DB tweak) fails fast with a
        // recognizable error rather than throwing inside Drizzle.
        if (
          !job.historicalTruckId
          || !job.historicalStartTime
          || !job.historicalEndTime
          || !job.historicalIntervalSeconds
        ) {
          throw new Error(
            "Historical export job is missing required fields (truckId, startTime, endTime, intervalSeconds)",
          );
        }
        const granularity = intervalSecondsToGranularity(job.historicalIntervalSeconds);
        result = await generateHistoricalExport({
          organizationId: job.organizationId,
          truckId: job.historicalTruckId,
          startTime: job.historicalStartTime,
          endTime: job.historicalEndTime,
          granularity,
          format,
        });
        historicalContext = {
          granularity,
          startTime: job.historicalStartTime,
          endTime: job.historicalEndTime,
          truckId: job.historicalTruckId,
        };
      } else {
        // jsonb columns deserialize natively — no JSON.parse needed.
        const filters = (job.filters as ExportFilters | null) ?? undefined;
        const includeColumns = (job.includeColumns as ColumnKey[] | null) ?? undefined;
        const excludeColumns = (job.excludeColumns as ColumnKey[] | null) ?? undefined;

        // bundleKey is validated against EXPORT_BUNDLES at /POST time, so the
        // narrowing assertion here is safe.
        result = await generateExport({
          organizationId: job.organizationId,
          bundleKey: job.bundleKey as BundleKey,
          format,
          filters,
          includeColumns,
          excludeColumns,
        });
      }

      // Per spec: exports/<orgId>/<jobId>/<filename>
      const s3Key = `exports/${job.organizationId}/${job.id}/${result.filename}`;
      await uploadFile(s3Key, result.buffer, result.contentType);

      const downloadUrl = await getFileUrl(s3Key, EXPORT_DOWNLOAD_TTL_SECONDS);
      const expiresAt = new Date(Date.now() + EXPORT_DOWNLOAD_TTL_SECONDS * 1000);

      const updated = await storage.updateExportJob(job.id, {
        status: EXPORT_JOB_STATUS.COMPLETED,
        s3Key,
        s3Filename: result.filename,
        downloadUrl,
        downloadUrlExpiresAt: expiresAt,
        rowCount: result.rowCount,
        columnCount: result.columnKeys.length,
        fileSizeBytes: result.buffer.byteLength,
        completedAt: new Date(),
      });

      // Notify by email — best-effort; do not fail the job if email fails.
      try {
        const user = await storage.getUserById(job.userId);
        if (user?.email) {
          // For historical exports we override the bundle label with a more
          // descriptive "Truck History (Hourly · Truck T-104)" string so the
          // email matches what the user actually requested. Snapshot exports
          // continue to surface the bundle label.
          const bundleLabel = historicalContext
            ? `Truck History (${HISTORICAL_GRANULARITY_META[historicalContext.granularity].label})`
            : EXPORT_BUNDLES[job.bundleKey as keyof typeof EXPORT_BUNDLES]?.label ?? job.bundleKey;
          const sent = await sendExportReadyEmail(user.email, {
            firstName: user.firstName ?? undefined,
            filename: result.filename,
            rowCount: result.rowCount,
            bundleLabel,
            downloadUrl,
            expiresAt,
            historical: historicalContext
              ? {
                  granularityLabel: HISTORICAL_GRANULARITY_META[historicalContext.granularity].label,
                  startTime: historicalContext.startTime,
                  endTime: historicalContext.endTime,
                }
              : undefined,
          });
          if (sent && updated) {
            await storage.updateExportJob(job.id, { notifiedAt: new Date() });
          }
        }
      } catch (err) {
        console.error(`[exports/worker] failed to send ready email for job ${job.id}:`, err);
      }

      console.log(
        `[exports/worker] completed job ${job.id} in ${Date.now() - startedAt}ms (${result.rowCount} rows, ${result.buffer.byteLength} bytes)`,
      );
    } catch (err: unknown) {
      const errorMessage = errorToString(err).slice(0, 1000);
      console.error(`[exports/worker] job ${job.id} failed:`, err);

      await storage.updateExportJob(job.id, {
        status: EXPORT_JOB_STATUS.FAILED,
        errorMessage,
        completedAt: new Date(),
      }).catch((updateErr) => {
        console.error(`[exports/worker] failed to mark job ${job.id} as failed:`, updateErr);
      });

      try {
        const user = await storage.getUserById(job.userId);
        if (user?.email) {
          await sendExportFailedEmail(user.email, {
            firstName: user.firstName ?? undefined,
            bundleLabel:
              EXPORT_BUNDLES[job.bundleKey as keyof typeof EXPORT_BUNDLES]?.label ?? job.bundleKey,
            errorMessage,
          });
        }
      } catch (emailErr) {
        console.error(`[exports/worker] failed to send failure email for job ${job.id}:`, emailErr);
      }
    }
  }
}

/**
 * Map the persisted `historicalIntervalSeconds` value back to the granularity
 * enum the historical generator expects. We chose this representation (vs a
 * separate `historical_granularity` text column) to avoid a schema migration —
 * the existing column was always intended to encode the bucket size.
 *
 * 60      → "minute"
 * 3600    → "hour"
 * 86400   → "day"
 *
 * Anything outside this set is treated as "minute" (the safest finest-grained
 * default) but logged so we notice if a non-standard value sneaks in.
 */
function intervalSecondsToGranularity(intervalSeconds: number): HistoricalGranularity {
  if (intervalSeconds === 60) return "minute";
  if (intervalSeconds === 3600) return "hour";
  if (intervalSeconds === 86400) return "day";
  console.warn(
    `[exports/worker] unexpected historicalIntervalSeconds=${intervalSeconds}, defaulting to minute granularity`,
  );
  return "minute";
}

function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

export const exportJobWorker = new ExportJobWorker();
