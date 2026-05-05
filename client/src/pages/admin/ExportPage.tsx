import { useEffect, useMemo, useState } from "react";
import { format as formatDate } from "date-fns";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminOrganizations,
  useAdminTrucks,
} from "@/lib/admin-api";
import {
  useCreateAdminExport,
  useAdminExportJobs,
  type SerializedAdminExportJob,
} from "@/lib/admin-exports-api";
import {
  HISTORICAL_GRANULARITY_META,
  HISTORICAL_MAX_RANGE_MS,
  HISTORICAL_MAX_ROWS,
  defaultGranularityForRangeDays,
  estimateHistoricalRows,
  type HistoricalGranularity,
} from "@shared/export-historical";
import { EXPORT_JOB_KIND } from "@shared/schema";

type Mode = "historical" | "devices";

function isoLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function startOfDayLocal(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDayLocal(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

const RANGE_PRESETS: Array<{ id: string; label: string; days: number }> = [
  { id: "d1", label: "Last 24 hours", days: 1 },
  { id: "d7", label: "Last 7 days", days: 7 },
  { id: "d30", label: "Last 30 days", days: 30 },
  { id: "d90", label: "Last 90 days", days: 90 },
  { id: "d365", label: "Last 1 year", days: 365 },
];

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function ExportPage() {
  return (
    <AdminLayout>
      <div className="px-6 lg:px-12 py-8 max-w-[1100px] mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
            Export
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Run cross-organization admin exports. Files are emailed when ready and listed
            below for 7 days.
          </p>
        </div>

        <ExportForm />
        <RecentExportsTable />
      </div>
    </AdminLayout>
  );
}

function ExportForm() {
  const [mode, setMode] = useState<Mode>("historical");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New export</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label className="text-xs text-muted-foreground">Type</Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            className="flex flex-wrap gap-4 mt-2"
          >
            <Label
              htmlFor="mode-historical"
              className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover-elevate"
            >
              <RadioGroupItem value="historical" id="mode-historical" data-testid="radio-mode-historical" />
              <span className="text-sm font-medium">Truck history (time-series)</span>
            </Label>
            <Label
              htmlFor="mode-devices"
              className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover-elevate"
            >
              <RadioGroupItem value="devices" id="mode-devices" data-testid="radio-mode-devices" />
              <span className="text-sm font-medium">Device registry (snapshot)</span>
            </Label>
          </RadioGroup>
        </div>

        {mode === "historical" ? <HistoricalForm /> : <DevicesForm />}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Historical form
// ---------------------------------------------------------------------------

function HistoricalForm() {
  const { toast } = useToast();
  const create = useCreateAdminExport();

  const orgsQuery = useAdminOrganizations();
  const orgs = orgsQuery.data?.organizations ?? [];

  const [orgId, setOrgId] = useState<number | undefined>(undefined);
  const trucksQuery = useAdminTrucks(orgId);
  const trucks = trucksQuery.data?.trucks ?? [];

  const [truckId, setTruckId] = useState<number | undefined>(undefined);
  const [presetId, setPresetId] = useState<string>("d30");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [granularity, setGranularity] = useState<HistoricalGranularity>("hour");
  const [granularityTouched, setGranularityTouched] = useState(false);
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [notifyByEmail, setNotifyByEmail] = useState(false);

  // Apply preset → date inputs.
  useEffect(() => {
    if (presetId === "custom") return;
    const preset = RANGE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const now = new Date();
    const start = new Date(now.getTime() - preset.days * 86400000);
    setStartDate(isoLocalDate(start));
    setEndDate(isoLocalDate(now));
    if (!granularityTouched) {
      setGranularity(defaultGranularityForRangeDays(preset.days));
    }
  }, [presetId, granularityTouched]);

  // Reset truck when org changes.
  useEffect(() => {
    setTruckId(undefined);
  }, [orgId]);

  const startMs = startDate ? startOfDayLocal(new Date(startDate)).getTime() : NaN;
  const endMs = endDate ? endOfDayLocal(new Date(endDate)).getTime() : NaN;
  const validRange =
    Number.isFinite(startMs)
    && Number.isFinite(endMs)
    && endMs > startMs
    && endMs - startMs <= HISTORICAL_MAX_RANGE_MS;

  const estimate = useMemo(() => {
    if (!validRange) return null;
    return estimateHistoricalRows({ startMs, endMs, granularity });
  }, [validRange, startMs, endMs, granularity]);

  const tooManyRows = !!estimate && estimate.exceedsMaxRows;
  const rangeTooLong =
    Number.isFinite(startMs) && Number.isFinite(endMs)
    && endMs - startMs > HISTORICAL_MAX_RANGE_MS;

  const canSubmit =
    !!orgId
    && !!truckId
    && validRange
    && !tooManyRows
    && !create.isPending;

  const submit = async () => {
    if (!orgId || !truckId || !validRange) return;
    try {
      await create.mutateAsync({
        kind: "historical",
        format,
        organizationId: orgId,
        truckId,
        granularity,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        notifyByEmail,
      });
      toast({
        title: "Export queued",
        description: notifyByEmail
          ? "We'll email you when it's ready and add it to the table below."
          : "Track progress in the table below.",
      });
    } catch (e) {
      const err = e as { message?: string };
      toast({
        title: "Could not queue export",
        description: err?.message ?? "Unexpected error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">Organization</Label>
          <Select
            value={orgId ? String(orgId) : ""}
            onValueChange={(v) => setOrgId(parseInt(v, 10))}
          >
            <SelectTrigger className="mt-1" data-testid="select-org">
              <SelectValue placeholder={orgsQuery.isLoading ? "Loading…" : "Select organization"} />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={String(o.id)} data-testid={`option-org-${o.id}`}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Truck</Label>
          <Select
            value={truckId ? String(truckId) : ""}
            onValueChange={(v) => setTruckId(parseInt(v, 10))}
            disabled={!orgId || trucksQuery.isLoading}
          >
            <SelectTrigger className="mt-1" data-testid="select-truck">
              <SelectValue
                placeholder={
                  !orgId
                    ? "Pick an organization first"
                    : trucksQuery.isLoading
                      ? "Loading trucks…"
                      : trucks.length === 0
                        ? "No trucks in this organization"
                        : "Select truck"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {trucks.map((t) => (
                <SelectItem key={t.id} value={String(t.id)} data-testid={`option-truck-${t.id}`}>
                  {t.truckNumber}
                  {t.driverName ? ` — ${t.driverName}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">Range preset</Label>
          <Select value={presetId} onValueChange={setPresetId}>
            <SelectTrigger className="mt-1" data-testid="select-range-preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground" htmlFor="input-start">Start date</Label>
          <Input
            id="input-start"
            type="date"
            className="mt-1"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPresetId("custom");
            }}
            data-testid="input-start-date"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground" htmlFor="input-end">End date</Label>
          <Input
            id="input-end"
            type="date"
            className="mt-1"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPresetId("custom");
            }}
            data-testid="input-end-date"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">Granularity</Label>
          <RadioGroup
            value={granularity}
            onValueChange={(v) => {
              setGranularity(v as HistoricalGranularity);
              setGranularityTouched(true);
            }}
            className="mt-2 space-y-2"
          >
            {(Object.keys(HISTORICAL_GRANULARITY_META) as HistoricalGranularity[]).map((g) => {
              const meta = HISTORICAL_GRANULARITY_META[g];
              return (
                <Label
                  key={g}
                  htmlFor={`gran-${g}`}
                  className="flex items-start gap-3 cursor-pointer rounded-md border border-border px-3 py-2 hover-elevate"
                >
                  <RadioGroupItem value={g} id={`gran-${g}`} data-testid={`radio-granularity-${g}`} />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{meta.label}</div>
                    <div className="text-xs text-muted-foreground">{meta.description}</div>
                  </div>
                </Label>
              );
            })}
          </RadioGroup>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as "csv" | "xlsx")}
              className="flex gap-4 mt-2"
            >
              <Label htmlFor="fmt-csv" className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="csv" id="fmt-csv" data-testid="radio-format-csv" />
                <span className="text-sm">CSV</span>
              </Label>
              <Label htmlFor="fmt-xlsx" className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="xlsx" id="fmt-xlsx" data-testid="radio-format-xlsx" />
                <span className="text-sm">Excel (.xlsx)</span>
              </Label>
            </RadioGroup>
          </div>

          <div className="rounded-md border border-border p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground">Estimated size</div>
            {!validRange ? (
              <div className="text-sm mt-1 text-muted-foreground" data-testid="text-estimate">
                Pick a valid date range
              </div>
            ) : (
              <div className="text-sm mt-1" data-testid="text-estimate">
                ≈ {estimate!.rowCount.toLocaleString()} rows ({formatBytes(estimate!.approxBytes)})
              </div>
            )}
            {rangeTooLong && (
              <div className="flex items-start gap-2 mt-2 text-sm text-destructive" data-testid="warn-range">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Range cannot exceed 1 year.</span>
              </div>
            )}
            {tooManyRows && (
              <div className="flex items-start gap-2 mt-2 text-sm text-destructive" data-testid="warn-rows">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Exceeds {HISTORICAL_MAX_ROWS.toLocaleString()} row cap. Choose a coarser
                  granularity or shorter range.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="hist-notify-email"
          checked={notifyByEmail}
          onCheckedChange={(v) => setNotifyByEmail(v === true)}
          data-testid="checkbox-historical-notify-email"
        />
        <Label htmlFor="hist-notify-email" className="cursor-pointer text-sm font-normal">
          Email me when ready
        </Label>
      </div>

      {create.error && (
        <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-error">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{create.error.message}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={!canSubmit} data-testid="button-submit-historical">
          {create.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Queuing…
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Queue export
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Devices form
// ---------------------------------------------------------------------------

function DevicesForm() {
  const { toast } = useToast();
  const create = useCreateAdminExport();

  const orgsQuery = useAdminOrganizations();
  const orgs = orgsQuery.data?.organizations ?? [];

  const [orgId, setOrgId] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [notifyByEmail, setNotifyByEmail] = useState(false);

  const submit = async () => {
    try {
      await create.mutateAsync({
        kind: "devices",
        format,
        organizationId: orgId === "all" ? null : orgId,
        searchQuery: searchQuery.trim() ? searchQuery.trim() : null,
        notifyByEmail,
      });
      toast({
        title: "Export queued",
        description: notifyByEmail
          ? "We'll email you when it's ready and add it to the table below."
          : "Track progress in the table below.",
      });
    } catch (e) {
      const err = e as { message?: string };
      toast({
        title: "Could not queue export",
        description: err?.message ?? "Unexpected error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">Organization scope</Label>
          <Select
            value={orgId === "all" ? "all" : String(orgId)}
            onValueChange={(v) => setOrgId(v === "all" ? "all" : parseInt(v, 10))}
          >
            <SelectTrigger className="mt-1" data-testid="select-devices-org">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organizations</SelectItem>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground" htmlFor="input-search">Search (optional)</Label>
          <Input
            id="input-search"
            className="mt-1"
            placeholder="Serial, MAC, applink URL…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-devices-search"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Format</Label>
        <RadioGroup
          value={format}
          onValueChange={(v) => setFormat(v as "csv" | "xlsx")}
          className="flex gap-4 mt-2"
        >
          <Label htmlFor="dfmt-csv" className="flex items-center gap-2 cursor-pointer">
            <RadioGroupItem value="csv" id="dfmt-csv" data-testid="radio-devices-format-csv" />
            <span className="text-sm">CSV</span>
          </Label>
          <Label htmlFor="dfmt-xlsx" className="flex items-center gap-2 cursor-pointer">
            <RadioGroupItem value="xlsx" id="dfmt-xlsx" data-testid="radio-devices-format-xlsx" />
            <span className="text-sm">Excel (.xlsx)</span>
          </Label>
        </RadioGroup>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="dev-notify-email"
          checked={notifyByEmail}
          onCheckedChange={(v) => setNotifyByEmail(v === true)}
          data-testid="checkbox-devices-notify-email"
        />
        <Label htmlFor="dev-notify-email" className="cursor-pointer text-sm font-normal">
          Email me when ready
        </Label>
      </div>

      {create.error && (
        <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-devices-error">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{create.error.message}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={create.isPending} data-testid="button-submit-devices">
          {create.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Queuing…
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Queue export
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent exports table
// ---------------------------------------------------------------------------

function RecentExportsTable() {
  const { data, isLoading } = useAdminExportJobs(20);
  const jobs = data?.jobs ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent exports</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6" data-testid="text-no-exports">
            No exports yet. Queue one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Rows</th>
                  <th className="py-2 pr-4 font-medium">Size</th>
                  <th className="py-2 pr-4 font-medium">Requested</th>
                  <th className="py-2 pr-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <ExportRow key={j.id} job={j} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExportRow({ job }: { job: SerializedAdminExportJob }) {
  const isHistorical = job.kind === EXPORT_JOB_KIND.ADMIN_HISTORICAL;
  const typeLabel = isHistorical ? "Truck history" : "Device registry";
  const requestedAt = job.requestedAt ? new Date(job.requestedAt) : null;

  return (
    <tr className="border-b border-border/60" data-testid={`row-export-${job.id}`}>
      <td className="py-3 pr-4">
        <Badge variant="secondary" data-testid={`badge-kind-${job.id}`}>{typeLabel}</Badge>
      </td>
      <td className="py-3 pr-4">
        <div className="font-medium text-foreground">{job.bundleLabel}</div>
        <div className="text-xs text-muted-foreground uppercase">{job.format}</div>
      </td>
      <td className="py-3 pr-4">
        <StatusBadge status={job.status} />
        {job.status === "failed" && job.errorMessage && (
          <div className="text-xs text-destructive mt-1 max-w-xs truncate" title={job.errorMessage}>
            {job.errorMessage}
          </div>
        )}
      </td>
      <td className="py-3 pr-4 text-foreground">{job.rowCount?.toLocaleString() ?? "—"}</td>
      <td className="py-3 pr-4 text-foreground">{formatBytes(job.fileSizeBytes)}</td>
      <td className="py-3 pr-4 text-muted-foreground">
        {requestedAt ? formatDate(requestedAt, "MMM d, yyyy HH:mm") : "—"}
      </td>
      <td className="py-3 pr-4 text-right">
        {job.status === "completed" && job.downloadUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={job.downloadUrl} data-testid={`link-download-${job.id}`}>
              <Download className="h-3 w-3 mr-1" />
              Download
            </a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Completed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Failed
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </Badge>
    );
  }
  if (status === "expired") {
    return (
      <Badge variant="outline" className="gap-1">
        <Clock className="h-3 w-3" />
        Expired
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" />
      Pending
    </Badge>
  );
}
