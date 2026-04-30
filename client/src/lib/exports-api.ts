import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import { useOrganization } from "./org-context";
import { useSession } from "./auth-api";
import type { BundleKey } from "@shared/export-columns";
import type { HistoricalGranularity } from "@shared/export-historical";

export type ExportJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "expired";

export interface ExportJobFilters {
  fleetId?: number;
  operationalStatus?: "in-service" | "not-in-service";
  searchQuery?: string;
}

export interface SerializedExportJob {
  id: number;
  organizationId: number;
  userId: number;
  bundleKey: string;
  bundleLabel: string;
  format: "csv" | "xlsx";
  status: ExportJobStatus;
  errorMessage: string | null;
  rowCount: number | null;
  columnCount: number | null;
  fileSizeBytes: number | null;
  filename: string | null;
  downloadUrl: string | null;
  downloadUrlExpiresAt: string | null;
  historicalMode: boolean | null;
  historicalTruckId: number | null;
  historicalStartTime: string | null;
  historicalEndTime: string | null;
  historicalIntervalSeconds: number | null;
  notifiedAt: string | null;
  dismissedAt: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ListExportJobsResponse {
  jobs: SerializedExportJob[];
}

interface CreateExportJobResponse {
  job: SerializedExportJob;
}

export interface CreateExportJobInput {
  bundleKey: BundleKey;
  format: "csv" | "xlsx";
  filters?: ExportJobFilters;
  includeColumns?: string[];
  excludeColumns?: string[];

  /**
   * Historical (single-truck time-series) inputs. When `historicalMode` is
   * true the snapshot fields above are ignored server-side; bundleKey is
   * still required by the schema but unused for routing — the dialog sends
   * a placeholder ("default") so the request validates.
   */
  historicalMode?: boolean;
  historicalTruckId?: number;
  /** ISO string; the server coerces to Date. */
  historicalStartTime?: string;
  /** ISO string; the server coerces to Date. */
  historicalEndTime?: string;
  /** "minute" | "hour" | "day" — server maps to interval seconds. */
  historicalGranularity?: HistoricalGranularity;
}

export interface CreateExportJobError {
  message: string;
  status: number;
  reason?: "user_limit" | "org_limit";
  activeUserCount?: number;
  activeOrgCount?: number;
  userLimit?: number;
  orgLimit?: number;
  /** Set when the server returned an estimated row count over the cap. */
  estimatedRowCount?: number;
  maxRows?: number;
  featureFlag?: string;
}

export const ACTIVE_EXPORTS_QUERY_KEY = "/api/v1/exports?active=true";

const ACTIVE_STATUSES: ExportJobStatus[] = ["pending", "running"];

/**
 * Banner data: pending + running + completed-not-dismissed + failed-not-dismissed.
 * Polls every 5s while at least one job is still in flight; pauses polling
 * otherwise so we're not hammering the server when there's nothing to watch.
 */
export function useActiveExports() {
  const { organizationId } = useOrganization();
  const { data: session } = useSession();
  // Belt-and-suspenders gate: also check session.authenticated, because the
  // org-context state is only cleared on explicit logout — a server-side
  // session expiry would otherwise leave a stale `organizationId` in memory
  // and let the banner keep firing requests after the user lands on /login.
  const enabled = !!organizationId && session?.authenticated === true;
  return useQuery<ListExportJobsResponse>({
    // Default queryFn uses queryKey[0] as the URL and adds the X-Organization-Id
    // header automatically via setOrganizationIdForRequests().
    queryKey: [ACTIVE_EXPORTS_QUERY_KEY, "org", organizationId],
    enabled,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const hasInFlight = jobs.some((j) => ACTIVE_STATUSES.includes(j.status));
      return hasInFlight ? 5000 : false;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export function useCreateExport() {
  const queryClient = useQueryClient();
  return useMutation<SerializedExportJob, CreateExportJobError, CreateExportJobInput>({
    mutationFn: async (input) => {
      try {
        const res = await apiRequest("POST", "/api/v1/exports", input);
        const body = (await res.json()) as CreateExportJobResponse;
        return body.job;
      } catch (e) {
        // `apiRequest`'s `throwIfResNotOk` throws `Error("${status}: ${text}")`
        // where `text` is the raw response body. Parse it back out so the
        // dialog can surface 429 limit details (reason / counts / limits)
        // and the 501 historical-mode `featureFlag` inline.
        throw parseExportError(e);
      }
    },
    onSuccess: () => {
      // Invalidate every variant of the active-exports query (org-scoped).
      queryClient.invalidateQueries({ queryKey: [ACTIVE_EXPORTS_QUERY_KEY] });
    },
  });
}

function parseExportError(e: unknown): CreateExportJobError {
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
    // body wasn't JSON — fall back to the raw text below.
  }
  const pickStr = (k: string) =>
    parsed && typeof parsed[k] === "string" ? (parsed[k] as string) : undefined;
  const pickNum = (k: string) =>
    parsed && typeof parsed[k] === "number" ? (parsed[k] as number) : undefined;
  const reasonRaw = pickStr("reason");
  const reason: CreateExportJobError["reason"] =
    reasonRaw === "user_limit" || reasonRaw === "org_limit" ? reasonRaw : undefined;
  return {
    message: pickStr("error") ?? rawBody ?? `Export request failed (${status})`,
    status,
    reason,
    activeUserCount: pickNum("activeUserCount"),
    activeOrgCount: pickNum("activeOrgCount"),
    userLimit: pickNum("userLimit"),
    orgLimit: pickNum("orgLimit"),
    estimatedRowCount: pickNum("estimatedRowCount"),
    maxRows: pickNum("maxRows"),
    featureFlag: pickStr("featureFlag"),
  };
}

export function useDismissExport() {
  const queryClient = useQueryClient();
  return useMutation<SerializedExportJob, Error, number>({
    mutationFn: async (jobId) => {
      const res = await apiRequest("PATCH", `/api/v1/exports/${jobId}/dismiss`);
      const body = (await res.json()) as CreateExportJobResponse;
      return body.job;
    },
    onMutate: async (jobId) => {
      await queryClient.cancelQueries({ queryKey: [ACTIVE_EXPORTS_QUERY_KEY] });
      const snapshots = queryClient.getQueriesData<ListExportJobsResponse>({
        queryKey: [ACTIVE_EXPORTS_QUERY_KEY],
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        queryClient.setQueryData<ListExportJobsResponse>(key, {
          jobs: data.jobs.filter((j) => j.id !== jobId),
        });
      }
      return { snapshots };
    },
    onError: (_err, _jobId, context) => {
      const ctx = context as { snapshots?: Array<[unknown, ListExportJobsResponse | undefined]> } | undefined;
      if (!ctx?.snapshots) return;
      for (const [key, data] of ctx.snapshots) {
        if (data) queryClient.setQueryData(key as readonly unknown[], data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [ACTIVE_EXPORTS_QUERY_KEY] });
    },
  });
}

/** Convenience: split a job list by display state. */
export function useExportJobBuckets(jobs: SerializedExportJob[]) {
  return useMemo(() => {
    const inFlight = jobs.filter((j) => j.status === "pending" || j.status === "running");
    const ready = jobs.filter((j) => j.status === "completed");
    const failed = jobs.filter((j) => j.status === "failed");
    return { inFlight, ready, failed };
  }, [jobs]);
}
