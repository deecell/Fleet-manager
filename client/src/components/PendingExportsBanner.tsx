import { Loader2, CheckCircle2, AlertCircle, Download, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useActiveExports,
  useDismissExport,
  type SerializedExportJob,
} from "@/lib/exports-api";

/**
 * App-shell banner that surfaces in-flight + recently-finished export jobs
 * across every page. Renders nothing when there's nothing to show.
 */
export function PendingExportsBanner() {
  const { data } = useActiveExports();
  const dismiss = useDismissExport();

  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) return null;

  return (
    <div
      className="sticky top-0 z-40 w-full bg-white border-b border-[#ebeef2] shadow-sm"
      data-testid="banner-exports"
    >
      <div className="px-6 lg:px-[144px] py-2 space-y-2">
        {jobs.map((job) => (
          <ExportRow
            key={job.id}
            job={job}
            onDismiss={() => dismiss.mutate(job.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface ExportRowProps {
  job: SerializedExportJob;
  onDismiss: () => void;
}

function ExportRow({ job, onDismiss }: ExportRowProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[#ebeef2] bg-[#fafbfc] px-3 py-2"
      data-testid={`export-row-${job.id}`}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0 basis-full sm:basis-0">
        <ExportIcon status={job.status} />
        <div className="flex-1 min-w-0">
          <ExportTitle job={job} />
          <ExportSubtitle job={job} />
        </div>
      </div>

      <div className="flex items-center gap-1 ml-auto sm:ml-0">
        {job.status === "completed" && job.downloadUrl && (
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
        )}

        {/* Every row gets its own dismiss. For pending/running this hides the
            row from the banner — the job continues processing in the
            background and the user still gets the email when it finishes. */}
        <Button
          size="icon"
          variant="ghost"
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid={`button-export-dismiss-${job.id}`}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function ExportIcon({ status }: { status: SerializedExportJob["status"] }) {
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

function ExportTitle({ job }: { job: SerializedExportJob }) {
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

function ExportSubtitle({ job }: { job: SerializedExportJob }) {
  if (job.status === "pending" || job.status === "running") {
    // Filename is null until the worker generates the file; synthesize a
    // friendly placeholder so the user still sees what's coming.
    const fileLabel = job.filename ?? `${job.bundleLabel}.${job.format}`;
    return (
      <p className="text-xs text-[#717182] truncate">
        {fileLabel} · We'll email you when it's ready.
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
