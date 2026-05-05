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

  /**
   * Opt-in: when true the worker also emails a SendGrid "ready" (or
   * "failed") notification. Default false — the recent-exports surface
   * + ExportsBanner are the primary notification channels.
   */
  notifyByEmail?: boolean;
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

/**
 * Default endpoint for customer-facing exports. The admin Devices export
 * (Task #5) reuses the same hooks with `endpoint = "/api/v1/admin/exports"`
 * — query keys and invalidations are scoped to the endpoint so the two
 * caches do not collide.
 */
export const CUSTOMER_EXPORTS_ENDPOINT = "/api/v1/exports";
export const ADMIN_EXPORTS_ENDPOINT = "/api/v1/admin/exports";

/** @deprecated use `activeExportsQueryKey(endpoint)` instead. Kept so existing
 * consumers that pass this around as an opaque string keep working. */
export const ACTIVE_EXPORTS_QUERY_KEY = `${CUSTOMER_EXPORTS_ENDPOINT}?active=true`;

const ACTIVE_STATUSES: ExportJobStatus[] = ["pending", "running"];

/**
 * Banner shape — the minimal subset of fields ExportsBanner renders. Both
 * the customer `SerializedExportJob` and the admin `SerializedAdminExportJob`
 * satisfy this. Hooks are typed against this so callers that don't need the
 * extra customer/admin fields don't have to do narrowing.
 */
export interface BannerExportJob {
  id: number;
  bundleLabel: string;
  format: "csv" | "xlsx" | string;
  status: ExportJobStatus;
  errorMessage: string | null;
  filename: string | null;
  downloadUrl: string | null;
  downloadUrlExpiresAt: string | null;
}

interface ActiveExportsResponse {
  jobs: BannerExportJob[];
}

function activeExportsQueryKey(endpoint: string) {
  return [`${endpoint}?active=true`];
}

/**
 * Banner data: pending + running + completed-not-dismissed + failed-not-dismissed.
 * Polls every 5s while at least one job is still in flight; pauses polling
 * otherwise so we're not hammering the server when there's nothing to watch.
 *
 * @param endpoint Defaults to the customer endpoint. Pass
 *                 `ADMIN_EXPORTS_ENDPOINT` for the admin banner — that
 *                 endpoint is gated by `adminMiddleware` and does not
 *                 require an X-Organization-Id header.
 */
export function useActiveExports(endpoint: string = CUSTOMER_EXPORTS_ENDPOINT) {
  const { organizationId } = useOrganization();
  const { data: session } = useSession();
  const isAdmin = endpoint === ADMIN_EXPORTS_ENDPOINT;
  // Customer endpoint requires both a customer session and an org context.
  // Admin endpoint is gated server-side by the admin cookie, which the
  // browser sends automatically — but we still want the banner to stop
  // polling once the customer logs out, so disable when neither auth
  // surface is present.
  const enabled = isAdmin
    ? true
    : !!organizationId && session?.authenticated === true;
  return useQuery<ActiveExportsResponse>({
    // Default queryFn uses queryKey[0] as the URL and adds the
    // X-Organization-Id header automatically via setOrganizationIdForRequests().
    // Org id is part of the customer key so switching orgs gets a fresh
    // cache; admin doesn't vary by org so its key is single-entry.
    queryKey: isAdmin
      ? activeExportsQueryKey(endpoint)
      : [...activeExportsQueryKey(endpoint), "org", organizationId],
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

/**
 * Customer create-export hook. Admin code paths use `useCreateAdminExport`
 * in `admin-exports-api.ts` (different request body shape).
 */
export function useCreateExport(endpoint: string = CUSTOMER_EXPORTS_ENDPOINT) {
  const queryClient = useQueryClient();
  return useMutation<SerializedExportJob, CreateExportJobError, CreateExportJobInput>({
    mutationFn: async (input) => {
      try {
        const res = await apiRequest("POST", endpoint, input);
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
      queryClient.invalidateQueries({ queryKey: activeExportsQueryKey(endpoint) });
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

export function useDismissExport(endpoint: string = CUSTOMER_EXPORTS_ENDPOINT) {
  const queryClient = useQueryClient();
  const queryKey = activeExportsQueryKey(endpoint);
  return useMutation<unknown, Error, number>({
    mutationFn: async (jobId) => {
      const res = await apiRequest("PATCH", `${endpoint}/${jobId}/dismiss`);
      return await res.json();
    },
    onMutate: async (jobId) => {
      await queryClient.cancelQueries({ queryKey });
      const snapshots = queryClient.getQueriesData<ActiveExportsResponse>({ queryKey });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        queryClient.setQueryData<ActiveExportsResponse>(key, {
          jobs: data.jobs.filter((j) => j.id !== jobId),
        });
      }
      return { snapshots };
    },
    onError: (_err, _jobId, context) => {
      const ctx = context as { snapshots?: Array<[unknown, ActiveExportsResponse | undefined]> } | undefined;
      if (!ctx?.snapshots) return;
      for (const [key, data] of ctx.snapshots) {
        if (data) queryClient.setQueryData(key as readonly unknown[], data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
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
