/**
 * Admin Exports client hooks.
 *
 * The customer-facing hooks (`useActiveExports`, `useDismissExport`) work
 * for both endpoints — pass `ADMIN_EXPORTS_ENDPOINT` to scope them to the
 * admin pipeline. Mutations and the recent-exports query live here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import {
  ADMIN_EXPORTS_ENDPOINT,
  type CreateExportJobError,
  type ExportJobStatus,
} from "./exports-api";
import type { HistoricalGranularity } from "@shared/export-historical";

export interface CreateAdminDevicesExportInput {
  kind: "devices";
  format: "csv" | "xlsx";
  organizationId?: number | null;
  searchQuery?: string | null;
}

export interface CreateAdminHistoricalExportInput {
  kind: "historical";
  format: "csv" | "xlsx";
  organizationId: number;
  truckId: number;
  granularity: HistoricalGranularity;
  /** ISO 8601 string. */
  startTime: string;
  /** ISO 8601 string. */
  endTime: string;
}

export type CreateAdminExportInput =
  | CreateAdminDevicesExportInput
  | CreateAdminHistoricalExportInput;

export interface SerializedAdminExportJob {
  id: number;
  kind: string;
  bundleLabel: string;
  format: "csv" | "xlsx";
  status: ExportJobStatus;
  errorMessage: string | null;
  rowCount: number | null;
  fileSizeBytes: number | null;
  filename: string | null;
  downloadUrl: string | null;
  downloadUrlExpiresAt: string | null;
  filters: {
    organizationId: number | null;
    organizationName: string | null;
    searchQuery: string | null;
  };
  historical: {
    truckId: number | null;
    truckNumber: string | null;
    granularity: HistoricalGranularity | null;
    startTime: string | null;
    endTime: string | null;
  } | null;
  notifiedAt: string | null;
  dismissedAt: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface CreateAdminExportResponse {
  job: SerializedAdminExportJob;
}

interface ListAdminExportsResponse {
  jobs: SerializedAdminExportJob[];
}

/**
 * Mutation: enqueue an admin export (devices OR historical, discriminated by
 * `kind`). Mirrors the customer error-parsing so the page can surface 429
 * limit details inline.
 */
export function useCreateAdminExport() {
  const queryClient = useQueryClient();
  return useMutation<SerializedAdminExportJob, CreateExportJobError, CreateAdminExportInput>({
    mutationFn: async (input) => {
      try {
        const res = await apiRequest("POST", ADMIN_EXPORTS_ENDPOINT, input);
        const body = (await res.json()) as CreateAdminExportResponse;
        return body.job;
      } catch (e) {
        throw parseAdminExportError(e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`${ADMIN_EXPORTS_ENDPOINT}?active=true`],
      });
      queryClient.invalidateQueries({
        queryKey: [ADMIN_EXPORTS_ENDPOINT, "recent"],
      });
    },
  });
}

/**
 * Recent admin export jobs (any status, includes dismissed) — drives the
 * recent-exports table on /admin/export. Polls every 5s while the page is
 * mounted so in-flight rows progress through pending → running → completed
 * without manual refresh.
 */
export function useAdminExportJobs(limit = 20) {
  return useQuery<ListAdminExportsResponse>({
    queryKey: [ADMIN_EXPORTS_ENDPOINT, "recent", limit],
    queryFn: async () => {
      const res = await fetch(`${ADMIN_EXPORTS_ENDPOINT}?limit=${limit}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load admin exports (${res.status})`);
      return res.json();
    },
    refetchInterval: 5000,
  });
}

function parseAdminExportError(e: unknown): CreateExportJobError {
  const message = e instanceof Error ? e.message : String(e);
  const m = /^(\d+):\s*([\s\S]*)$/.exec(message);
  const status = m ? parseInt(m[1], 10) : 0;
  const rawBody = m ? m[2] : message;
  let parsed: Record<string, unknown> | null = null;
  try {
    const candidate = JSON.parse(rawBody) as unknown;
    if (candidate && typeof candidate === "object") {
      parsed = candidate as Record<string, unknown>;
    }
  } catch {
    // body wasn't JSON
  }
  const pickStr = (k: string) =>
    parsed && typeof parsed[k] === "string" ? (parsed[k] as string) : undefined;
  const pickNum = (k: string) =>
    parsed && typeof parsed[k] === "number" ? (parsed[k] as number) : undefined;
  const reasonRaw = pickStr("reason");
  const reason: CreateExportJobError["reason"] =
    reasonRaw === "user_limit" || reasonRaw === "org_limit" ? reasonRaw : undefined;
  return {
    message: pickStr("error") ?? rawBody ?? `Admin export request failed (${status})`,
    status,
    reason,
    activeUserCount: pickNum("activeUserCount"),
    activeOrgCount: pickNum("activeOrgCount"),
    userLimit: pickNum("userLimit"),
    orgLimit: pickNum("orgLimit"),
  };
}
