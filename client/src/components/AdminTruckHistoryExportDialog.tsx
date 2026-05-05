import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Download, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateAdminExport } from "@/lib/admin-exports-api";
import type { CreateExportJobError } from "@/lib/exports-api";
import {
  HISTORICAL_GRANULARITY_META,
  HISTORICAL_MAX_ROWS,
  defaultGranularityForRangeDays,
  estimateHistoricalRows,
  type HistoricalGranularity,
} from "@shared/export-historical";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-seeded truck (the device's assigned truck). */
  truckId: number;
  truckNumber: string;
  /** Org that owns the truck — sent on the job's filters payload. */
  organizationId: number;
  organizationName: string | null;
}

const RANGE_PRESETS: Array<{ id: string; label: string; days: number }> = [
  { id: "d1", label: "Last 24 hours", days: 1 },
  { id: "d7", label: "Last 7 days", days: 7 },
  { id: "d30", label: "Last 30 days", days: 30 },
  { id: "d90", label: "Last 90 days", days: 90 },
  { id: "d365", label: "Last 1 year", days: 365 },
];

/**
 * Per-device historical export dialog (Task #9). Opened from the Download
 * icon on a device row in /admin/devices when that device is assigned to a
 * truck. Posts an admin_historical job through the existing admin export
 * pipeline — the synthetic Deecell admin user owns the job, the target
 * customer org rides on filters.organizationId.
 */
export function AdminTruckHistoryExportDialog({
  open,
  onOpenChange,
  truckId,
  truckNumber,
  organizationId,
  organizationName,
}: Props) {
  const { toast } = useToast();
  const create = useCreateAdminExport();

  const [presetId, setPresetId] = useState<string>("d30");
  const [granularity, setGranularity] = useState<HistoricalGranularity>(
    defaultGranularityForRangeDays(30),
  );
  const [granularityTouched, setGranularityTouched] = useState(false);
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [notifyByEmail, setNotifyByEmail] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Reset on open so a previous run doesn't bleed into the next.
  useEffect(() => {
    if (!open) return;
    setPresetId("d30");
    setGranularity(defaultGranularityForRangeDays(30));
    setGranularityTouched(false);
    setFormat("csv");
    setNotifyByEmail(false);
    setErrorBanner(null);
  }, [open]);

  const preset = RANGE_PRESETS.find((p) => p.id === presetId) ?? RANGE_PRESETS[2];

  // Auto-suggest a sensible granularity when the range changes — but only
  // until the user picks one manually for this session.
  useEffect(() => {
    if (granularityTouched) return;
    setGranularity(defaultGranularityForRangeDays(preset.days));
  }, [preset.days, granularityTouched]);

  const { startMs, endMs } = useMemo(() => {
    const now = Date.now();
    return { startMs: now - preset.days * 86400000, endMs: now };
  }, [preset.days]);

  const estimate = useMemo(
    () => estimateHistoricalRows({ startMs, endMs, granularity }),
    [startMs, endMs, granularity],
  );
  const tooManyRows = estimate.exceedsMaxRows;

  const submit = async () => {
    setErrorBanner(null);
    if (tooManyRows) return;
    try {
      await create.mutateAsync({
        kind: "historical",
        format,
        organizationId,
        truckId,
        granularity,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        notifyByEmail,
      });
      toast({
        title: "Export queued",
        description: notifyByEmail
          ? `We'll email you when truck ${truckNumber} history is ready.`
          : `Track progress in the exports list — truck ${truckNumber} history is on its way.`,
      });
      onOpenChange(false);
    } catch (e) {
      const err = e as CreateExportJobError;
      setErrorBanner(err.message || "Failed to start export");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-admin-truck-history-export">
        <DialogHeader>
          <DialogTitle>Export truck history</DialogTitle>
          <DialogDescription>
            Generate a time-series export for truck{" "}
            <span className="font-medium text-foreground">{truckNumber}</span>
            {organizationName ? (
              <>
                {" "}in{" "}
                <span className="font-medium text-foreground">{organizationName}</span>
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Range</Label>
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger className="mt-1" data-testid="select-truck-history-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Granularity</Label>
            <RadioGroup
              value={granularity}
              onValueChange={(v) => {
                setGranularity(v as HistoricalGranularity);
                setGranularityTouched(true);
              }}
              className="mt-2 flex flex-wrap gap-2"
            >
              {(Object.keys(HISTORICAL_GRANULARITY_META) as HistoricalGranularity[]).map((g) => {
                const meta = HISTORICAL_GRANULARITY_META[g];
                return (
                  <Label
                    key={g}
                    htmlFor={`truck-hist-gran-${g}`}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover-elevate"
                  >
                    <RadioGroupItem
                      value={g}
                      id={`truck-hist-gran-${g}`}
                      data-testid={`radio-truck-history-granularity-${g}`}
                    />
                    <span className="text-sm">{meta.label}</span>
                  </Label>
                );
              })}
            </RadioGroup>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as "csv" | "xlsx")}
              className="mt-2 flex gap-4"
            >
              <Label htmlFor="truck-hist-fmt-csv" className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem
                  value="csv"
                  id="truck-hist-fmt-csv"
                  data-testid="radio-truck-history-format-csv"
                />
                <span className="text-sm">CSV</span>
              </Label>
              <Label htmlFor="truck-hist-fmt-xlsx" className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem
                  value="xlsx"
                  id="truck-hist-fmt-xlsx"
                  data-testid="radio-truck-history-format-xlsx"
                />
                <span className="text-sm">Excel (.xlsx)</span>
              </Label>
            </RadioGroup>
          </div>

          <div className="rounded-md border border-border p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground">Estimated size</div>
            <div className="text-sm mt-1" data-testid="text-truck-history-estimate">
              ≈ {estimate.rowCount.toLocaleString()} rows
            </div>
            {tooManyRows && (
              <div
                className="flex items-start gap-2 mt-2 text-sm text-destructive"
                data-testid="warn-truck-history-rows"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Exceeds {HISTORICAL_MAX_ROWS.toLocaleString()} row cap. Choose a coarser
                  granularity or shorter range.
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="truck-hist-notify-email"
              checked={notifyByEmail}
              onCheckedChange={(v) => setNotifyByEmail(v === true)}
              data-testid="checkbox-truck-history-notify-email"
            />
            <Label
              htmlFor="truck-hist-notify-email"
              className="cursor-pointer text-sm font-normal"
            >
              Email me when ready
            </Label>
          </div>

          {errorBanner && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="text-truck-history-export-error"
            >
              {errorBanner}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
            data-testid="button-truck-history-export-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={create.isPending || tooManyRows}
            data-testid="button-truck-history-export-submit"
          >
            {create.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Queuing…
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
