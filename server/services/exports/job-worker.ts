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
import type { ExportFilters } from "./types";

const POLL_INTERVAL_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

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
      if (job.historicalMode) {
        // Task #4 will fill this in. For now, fail loudly so a partially-built
        // historical job never completes with a snapshot file pretending to be
        // historical data.
        throw new Error("Historical export mode is not yet implemented");
      }

      const filters = parseJson<ExportFilters>(job.filters) ?? undefined;
      const includeColumns = parseJson<ColumnKey[]>(job.includeColumns) ?? undefined;
      const excludeColumns = parseJson<ColumnKey[]>(job.excludeColumns) ?? undefined;
      const format = (job.format === "xlsx" ? "xlsx" : "csv") as "csv" | "xlsx";

      // bundleKey is validated against EXPORT_BUNDLES at /POST time, so the
      // narrowing assertion here is safe.
      const result = await generateExport({
        organizationId: job.organizationId,
        bundleKey: job.bundleKey as BundleKey,
        format,
        filters,
        includeColumns,
        excludeColumns,
      });

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
          const sent = await sendExportReadyEmail(user.email, {
            firstName: user.firstName ?? undefined,
            filename: result.filename,
            rowCount: result.rowCount,
            bundleLabel:
              EXPORT_BUNDLES[job.bundleKey as keyof typeof EXPORT_BUNDLES]?.label ?? job.bundleKey,
            downloadUrl,
            expiresAt,
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
    } catch (err: any) {
      const errorMessage = err?.message ? String(err.message).slice(0, 1000) : "Unknown error";
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

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export const exportJobWorker = new ExportJobWorker();
