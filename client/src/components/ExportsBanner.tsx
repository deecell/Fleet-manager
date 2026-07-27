import { Loader2, CheckCircle2, AlertCircle, Download, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ADMIN_EXPORTS_ENDPOINT,
  CUSTOMER_EXPORTS_ENDPOINT,
  useActiveExports,
  useDismissExport,
  type BannerExportJob,
} from "@/lib/exports-api";

interface ExportsBannerProps {
  /**
   * Backend endpoint to poll for active jobs. Defaults to the customer
   * endpoint. Pass `ADMIN_EXPORTS_ENDPOINT` for the admin banner.
   */
  endpoint?: string;
}

/**
 * Fixed top-right notification stack that surfaces in-flight + recently-
 * finished export jobs across every page. Renders nothing when there's
 * nothing to show.
 *
 * Mounted twice in `App.tsx`, both outside the router so neither remounts
 * on navigation:
 *   - Customer shell → CUSTOMER_EXPORTS_ENDPOINT (always mounted)
 *   - Admin shell    → ADMIN_EXPORTS_ENDPOINT (mounted only while on /admin/*,
 *     via the `AdminExportsBanner` gate in App.tsx)
 *
 * The two mounts use endpoint-scoped query keys so their caches don't
 * collide.
 */
export function ExportsBanner({
  endpoint = CUSTOMER_EXPORTS_ENDPOINT,
}: ExportsBannerProps = {}) {
  const { data } = useActiveExports(endpoint);
  const dismiss = useDismissExport(endpoint);

  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) return null;

  const isAdmin = endpoint === ADMIN_EXPORTS_ENDPOINT;
  const testIdSuffix = isAdmin ? "-admin" : "";

  return (
    <div
      className="fixed top-4 right-4 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      data-testid={`banner-exports${testIdSuffix}`}
    >
      {jobs.map((job) => (
        <ExportRow
          key={job.id}
          job={job}
          onDismiss={() => dismiss.mutate(job.id)}
        />
      ))}
    </div>
  );
}

/** Backwards-compatible alias for the old component name. */
export const PendingExportsBanner = ExportsBanner;

interface ExportRowProps {
  job: BannerExportJob;
  onDismiss: () => void;
}

function ExportRow({ job, onDismiss }: ExportRowProps) {
  return (
    <div
      className="rounded-lg border border-[#ebeef2] bg-white px-3 py-3 shadow-lg"
      data-testid={`export-row-${job.id}`}
    >
      <div className="flex items-start gap-3">
        <ExportIcon status={job.status} />
        <div className="flex-1 min-w-0">
          <ExportTitle job={job} />
          <ExportSubtitle job={job} />
        </div>

        {/* Every row gets its own dismiss. For pending/running this hides the
            row from the banner — the job continues processing in the
            background and the user still gets the email when it finishes. */}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 -mt-1 -mr-1 shrink-0"
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid={`button-export-dismiss-${job.id}`}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {job.status === "completed" && job.downloadUrl && (
        <div className="mt-2 flex justify-end">
          <Button
            asChild
            size="sm"
            data-testid={`button-export-download-${job.id}`}
          >
            <a
              href={job.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className="w-4 h-4 mr-1" />
              Download
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

function ExportIcon({ status }: { status: BannerExportJob["status"] }) {
  if (status === "pending" || status === "running") {
    return <Loader2 className="w-5 h-5 text-[#6a7fbc] animate-spin shrink-0" />;
  }
  if (status === "completed") {
    return <CheckCircle2 className="w-5 h-5 text-[#39c900] shrink-0" />;
  }
  if (status === "failed") {
    return <AlertCircle className="w-5 h-5 text-destructive shrink-0" />;
  }
  return <FileText className="w-5 h-5 text-[#717182] shrink-0" />;
}

function ExportTitle({ job }: { job: BannerExportJob }) {
  if (job.status === "pending" || job.status === "running") {
    return (
      <p
        className="text-sm font-medium text-neutral-950 truncate"
        data-testid={`text-export-title-${job.id}`}
      >
        Export in progress — {job.bundleLabel} ({job.format.toUpperCase()})
      </p>
    );
  }
  if (job.status === "completed") {
    return (
      <p
        className="text-sm font-medium text-neutral-950 truncate"
        data-testid={`text-export-title-${job.id}`}
      >
        Your export is ready — {job.bundleLabel}
      </p>
    );
  }
  if (job.status === "failed") {
    return (
      <p
        className="text-sm font-medium text-destructive truncate"
        data-testid={`text-export-title-${job.id}`}
      >
        Export failed: {job.errorMessage ?? "Unknown error"}
      </p>
    );
  }
  return (
    <p
      className="text-sm font-medium text-[#717182] truncate"
      data-testid={`text-export-title-${job.id}`}
    >
      Export expired — {job.bundleLabel}
    </p>
  );
}

function ExportSubtitle({ job }: { job: BannerExportJob }) {
  if (job.status === "pending" || job.status === "running") {
    // Filename is null until the worker generates the file; synthesize a
    // friendly placeholder so the user still sees what's coming.
    const fileLabel = job.filename ?? `${job.bundleLabel}.${job.format}`;
    return (
      <p className="text-xs text-[#717182] truncate">
        {fileLabel} · We'll update this banner when it's ready.
      </p>
    );
  }
  if (job.status === "completed") {
    const fileLabel = job.filename ?? `${job.bundleLabel}.${job.format}`;
    const expires = formatExpiry(job.downloadUrlExpiresAt);
    return (
      <p className="text-xs text-[#717182] truncate">
        {fileLabel}
        {expires && <span> · {expires}</span>}
      </p>
    );
  }
  return null;
}

function formatExpiry(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `Expires in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
}
