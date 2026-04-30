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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Calendar as CalendarIcon,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { format as formatDate } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  BUNDLE_KEYS,
  EXPORT_BUNDLES,
  EXPORT_COLUMN_LIST,
  type BundleKey,
  type ColumnKey,
} from "@shared/export-columns";
import {
  HISTORICAL_GRANULARITIES,
  HISTORICAL_GRANULARITY_META,
  HISTORICAL_MAX_RANGE_MS,
  defaultGranularityForRangeDays,
  estimateHistoricalRows,
  type HistoricalGranularity,
} from "@shared/export-historical";
import {
  useCreateExport,
  type CreateExportJobError,
  type ExportJobFilters,
} from "@/lib/exports-api";
import { useTrucks } from "@/lib/api";

type ExportMode = "snapshot" | "historical";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filters currently applied on the dashboard. Read-only here. */
  filters: ExportDialogFilters;
  /**
   * When opening from a single-truck context (TruckDetail page), pre-select
   * historical mode + the truck. The dialog still lets the user switch back
   * to snapshot mode if they change their mind.
   */
  initialMode?: ExportMode;
  initialTruckId?: number;
  initialRangeDays?: number;
}

export interface ExportDialogFilters {
  status: "all" | "in-service" | "not-in-service";
  searchQuery: string;
  fleetId?: number;
  fleetName?: string;
}

/**
 * Convert dashboard filters → API shape (only include the keys with meaningful values).
 */
function toApiFilters(f: ExportDialogFilters): ExportJobFilters | undefined {
  const out: ExportJobFilters = {};
  if (f.status !== "all") out.operationalStatus = f.status;
  const q = f.searchQuery.trim();
  if (q.length > 0) out.searchQuery = q;
  if (f.fleetId) out.fleetId = f.fleetId;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Group columns by `group` field, preserving registry order. */
const COLUMN_GROUPS: Array<{ group: string; columns: typeof EXPORT_COLUMN_LIST }> = (() => {
  const map = new Map<string, typeof EXPORT_COLUMN_LIST>();
  for (const col of EXPORT_COLUMN_LIST) {
    const g = col.group ?? "Other";
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(col);
  }
  return Array.from(map.entries()).map(([group, columns]) => ({ group, columns }));
})();

// Range presets. Trailing-window presets carry a `days` field that also
// drives the granularity auto-suggest. Calendar-anchored presets (MTD, YTD,
// Last month, Last year) compute their own bounds and report a derived day
// count from the resolved range.
type RangePreset = {
  id: string;
  label: string;
  /** Trailing-window day count, if applicable. Falsy for calendar presets. */
  days?: number;
  /** Computes the absolute [start, end] for the preset relative to "now". */
  resolve: (now: Date) => { start: Date; end: Date };
};

function trailingPreset(id: string, label: string, days: number): RangePreset {
  return {
    id,
    label,
    days,
    resolve: (now) => ({
      start: new Date(now.getTime() - days * 86400000),
      end: now,
    }),
  };
}

const RANGE_PRESETS: RangePreset[] = [
  trailingPreset("d1", "Last 24 hours", 1),
  trailingPreset("d7", "Last 7 days", 7),
  trailingPreset("d30", "Last 30 days", 30),
  trailingPreset("d90", "Last 90 days", 90),
  trailingPreset("d365", "Last 1 year", 365),
  {
    id: "mtd",
    label: "Month to date",
    resolve: (now) => ({
      start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: now,
    }),
  },
  {
    id: "ytd",
    label: "Year to date",
    resolve: (now) => ({
      start: startOfDay(new Date(now.getFullYear(), 0, 1)),
      end: now,
    }),
  },
  {
    id: "last_month",
    label: "Last month",
    resolve: (now) => {
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const end = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return { start, end };
    },
  },
  {
    id: "last_year",
    label: "Last year",
    resolve: (now) => {
      const start = startOfDay(new Date(now.getFullYear() - 1, 0, 1));
      const end = endOfDay(new Date(now.getFullYear() - 1, 11, 31));
      return { start, end };
    },
  },
];

const RANGE_PRESETS_BY_ID: Record<string, RangePreset> = Object.fromEntries(
  RANGE_PRESETS.map((p) => [p.id, p]),
);

function presetIdForDays(days: number): string {
  // Map a days hint (e.g. seeded by TruckDetail) to an existing trailing preset.
  const exact = RANGE_PRESETS.find((p) => p.days === days);
  return exact?.id ?? "d30";
}

function isoDate(d: Date): string {
  // Returns yyyy-MM-dd in local time — what `<Input type="date">` expects.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function ExportDialog({
  open,
  onOpenChange,
  filters,
  initialMode = "snapshot",
  initialTruckId,
  initialRangeDays = 7,
}: ExportDialogProps) {
  const { toast } = useToast();
  const createExport = useCreateExport();
  const trucksQuery = useTrucks();

  // Mode + snapshot state
  const [mode, setMode] = useState<ExportMode>(initialMode);
  const [bundleKey, setBundleKey] = useState<BundleKey>("default");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<Set<ColumnKey>>(
    () => new Set(EXPORT_BUNDLES.default.columnKeys as ColumnKey[]),
  );

  // Historical state. We store start/end as `yyyy-MM-dd` strings so the
  // <Input type="date"> elements can drive them directly. "custom" preset
  // lets the user free-edit; any other preset re-derives the range on
  // change. Granularity defaults to whatever fits the range size.
  const [historicalTruckId, setHistoricalTruckId] = useState<number | undefined>(initialTruckId);
  const [rangePresetId, setRangePresetId] = useState<string>(presetIdForDays(initialRangeDays));
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [granularity, setGranularity] = useState<HistoricalGranularity>(
    defaultGranularityForRangeDays(initialRangeDays),
  );
  const [granularityTouched, setGranularityTouched] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);

  // When dialog opens, reset to a clean state. Filters / context can change
  // between opens, so we don't persist the user's last picks across sessions.
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setBundleKey("default");
    setFormat("csv");
    setSelectedColumns(new Set(EXPORT_BUNDLES.default.columnKeys as ColumnKey[]));
    setAdvancedOpen(false);
    setSubmitError(null);
    setHistoricalTruckId(initialTruckId);
    setRangePresetId(presetIdForDays(initialRangeDays));
    const today = new Date();
    setCustomStart(isoDate(new Date(today.getTime() - initialRangeDays * 86400000)));
    setCustomEnd(isoDate(today));
    setGranularity(defaultGranularityForRangeDays(initialRangeDays));
    setGranularityTouched(false);
  }, [open, initialMode, initialTruckId, initialRangeDays]);

  // Selecting a bundle resets checkboxes to that bundle's defaults; manual
  // checkbox edits are then preserved while the same bundle stays selected.
  const handleBundleChange = (next: string) => {
    if (!isBundleKey(next)) return;
    setBundleKey(next);
    setSelectedColumns(new Set(EXPORT_BUNDLES[next].columnKeys as ColumnKey[]));
  };

  const toggleColumn = (key: ColumnKey, checked: boolean) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  // Compute the include/exclude diff against the bundle's defaults so the
  // server stores only what the user changed (cleaner audit trail + smaller
  // payload). Empty arrays are omitted from the request.
  const { includeColumns, excludeColumns, selectedCount } = useMemo(() => {
    const bundleSet = new Set<ColumnKey>(EXPORT_BUNDLES[bundleKey].columnKeys as ColumnKey[]);
    const include: ColumnKey[] = [];
    const exclude: ColumnKey[] = [];
    for (const col of EXPORT_COLUMN_LIST) {
      const key = col.key as ColumnKey;
      const inSelected = selectedColumns.has(key);
      const inBundle = bundleSet.has(key);
      if (inSelected && !inBundle) include.push(key);
      if (!inSelected && inBundle) exclude.push(key);
    }
    return { includeColumns: include, excludeColumns: exclude, selectedCount: selectedColumns.size };
  }, [bundleKey, selectedColumns]);

  // Resolve the active date range — preset (relative to "now") or custom.
  // The 1-year cap is enforced uniformly here so presets (e.g. "Last year"
  // on a leap-year window) and custom ranges fail the same way client-side.
  const { startTime, endTime, rangeDays, rangeError } = useMemo(() => {
    const now = new Date();
    let s: Date;
    let e: Date;
    if (rangePresetId === "custom") {
      if (!customStart || !customEnd) {
        return { startTime: null, endTime: null, rangeDays: 0, rangeError: "Pick a start and end date." };
      }
      s = startOfDay(new Date(customStart));
      e = endOfDay(new Date(customEnd));
      if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) {
        return { startTime: null, endTime: null, rangeDays: 0, rangeError: "Invalid date." };
      }
      if (e <= s) {
        return { startTime: s, endTime: e, rangeDays: 0, rangeError: "End date must be after start date." };
      }
    } else {
      const preset = RANGE_PRESETS_BY_ID[rangePresetId];
      if (!preset) {
        return { startTime: null, endTime: null, rangeDays: 0, rangeError: "Unknown range." };
      }
      const resolved = preset.resolve(now);
      s = resolved.start;
      e = resolved.end;
    }
    const days = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86400000));
    if (e.getTime() - s.getTime() > HISTORICAL_MAX_RANGE_MS) {
      return { startTime: s, endTime: e, rangeDays: days, rangeError: "Range can't be longer than 1 year." };
    }
    return { startTime: s, endTime: e, rangeDays: days, rangeError: null as string | null };
  }, [rangePresetId, customStart, customEnd]);

  // Auto-suggest granularity when the range changes — but stop overriding
  // once the user has manually picked one for this dialog session.
  useEffect(() => {
    if (granularityTouched || rangeDays <= 0) return;
    setGranularity(defaultGranularityForRangeDays(rangeDays));
  }, [rangeDays, granularityTouched]);

  // Estimated rows / bytes for the preview line.
  const estimate = useMemo(() => {
    if (!startTime || !endTime || endTime <= startTime) return null;
    return estimateHistoricalRows({
      granularity,
      startMs: startTime.getTime(),
      endMs: endTime.getTime(),
    });
  }, [startTime, endTime, granularity]);

  const filterChips = useMemo(() => {
    const chips: Array<{ label: string; testId: string }> = [];
    if (filters.status === "in-service") {
      chips.push({ label: "Status: In Service", testId: "filter-chip-status" });
    } else if (filters.status === "not-in-service") {
      chips.push({ label: "Status: Not In Service", testId: "filter-chip-status" });
    }
    const q = filters.searchQuery.trim();
    if (q.length > 0) {
      chips.push({ label: `Search: ${q}`, testId: "filter-chip-search" });
    }
    if (filters.fleetId && filters.fleetName) {
      chips.push({ label: `Fleet: ${filters.fleetName}`, testId: "filter-chip-fleet" });
    }
    return chips;
  }, [filters]);

  const trucks = trucksQuery.data?.trucks ?? [];

  const handleSubmit = async () => {
    setSubmitError(null);

    if (mode === "snapshot") {
      if (selectedCount === 0) {
        setSubmitError("Pick at least one column to export.");
        return;
      }
      try {
        const job = await createExport.mutateAsync({
          bundleKey,
          format,
          filters: toApiFilters(filters),
          includeColumns: includeColumns.length > 0 ? includeColumns : undefined,
          excludeColumns: excludeColumns.length > 0 ? excludeColumns : undefined,
        });
        toast({
          title: "Export queued",
          description: `We'll email you when ${job.bundleLabel} is ready.`,
        });
        onOpenChange(false);
      } catch (err) {
        handleError(err);
      }
      return;
    }

    // Historical mode
    if (!historicalTruckId) {
      setSubmitError("Pick a truck.");
      return;
    }
    if (!startTime || !endTime || rangeError) {
      setSubmitError(rangeError ?? "Pick a valid date range.");
      return;
    }
    if (estimate?.exceedsMaxRows) {
      setSubmitError(
        `Estimated ${estimate.rowCount.toLocaleString()} rows is too many. Try a shorter range or a coarser granularity.`,
      );
      return;
    }
    try {
      const job = await createExport.mutateAsync({
        // bundleKey is unused server-side for historical mode but the schema
        // still requires a valid key — send "default" as a placeholder.
        bundleKey: "default",
        format,
        historicalMode: true,
        historicalTruckId,
        historicalStartTime: startTime.toISOString(),
        historicalEndTime: endTime.toISOString(),
        historicalGranularity: granularity,
      });
      toast({
        title: "Export queued",
        description: `We'll email you when ${job.bundleLabel} is ready.`,
      });
      onOpenChange(false);
    } catch (err) {
      handleError(err);
    }
  };

  const handleError = (err: unknown) => {
    const e = err as CreateExportJobError;
    setSubmitError(e.message);
    if (e.status !== 429) {
      toast({
        title: "Export failed",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  const submitting = createExport.isPending;
  const submitDisabled =
    submitting ||
    (mode === "snapshot" && selectedCount === 0) ||
    (mode === "historical" &&
      (!historicalTruckId || !startTime || !endTime || !!rangeError || estimate?.exceedsMaxRows === true));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="dialog-export"
      >
        <DialogHeader>
          <DialogTitle data-testid="text-export-title">Export Fleet Data</DialogTitle>
          <DialogDescription>
            Pick what you want to export. We'll process it in the background and
            email you a download link when it's ready.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Mode toggle */}
          <section>
            <Label className="text-sm font-semibold text-neutral-950">What to export</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v === "historical" ? "historical" : "snapshot")}
              className="mt-3 flex gap-2"
              data-testid="radio-group-mode"
            >
              <div className="flex items-center gap-2 rounded-md border border-[#ebeef2] px-3 py-2 hover-elevate flex-1">
                <RadioGroupItem value="snapshot" id="mode-snapshot" data-testid="radio-mode-snapshot" />
                <Label htmlFor="mode-snapshot" className="text-sm cursor-pointer">
                  Fleet snapshot
                  <span className="block text-xs font-normal text-[#717182]">
                    Current state of every truck
                  </span>
                </Label>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-[#ebeef2] px-3 py-2 hover-elevate flex-1">
                <RadioGroupItem value="historical" id="mode-historical" data-testid="radio-mode-historical" />
                <Label htmlFor="mode-historical" className="text-sm cursor-pointer">
                  Truck history
                  <span className="block text-xs font-normal text-[#717182]">
                    Time-series for one truck
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </section>

          {/* === SNAPSHOT MODE === */}
          {mode === "snapshot" && (
            <>
              {/* Bundle picker */}
              <section>
                <Label className="text-sm font-semibold text-neutral-950">Bundle</Label>
                <RadioGroup
                  value={bundleKey}
                  onValueChange={handleBundleChange}
                  className="mt-3 space-y-2"
                  data-testid="radio-group-bundle"
                >
                  {BUNDLE_KEYS.map((key) => {
                    const bundle = EXPORT_BUNDLES[key];
                    return (
                      <div
                        key={key}
                        className="flex items-start gap-3 rounded-md border border-[#ebeef2] p-3 hover-elevate"
                        data-testid={`bundle-option-${key}`}
                      >
                        <RadioGroupItem
                          value={key}
                          id={`bundle-${key}`}
                          className="mt-0.5"
                          data-testid={`radio-bundle-${key}`}
                        />
                        <div className="flex-1 min-w-0">
                          <Label
                            htmlFor={`bundle-${key}`}
                            className="text-sm font-medium text-neutral-950 cursor-pointer"
                          >
                            {bundle.label}
                            <span className="ml-2 text-xs font-normal text-[#717182]">
                              {bundle.columnKeys.length} columns
                            </span>
                          </Label>
                          <p className="text-xs text-[#4a5565] mt-0.5">
                            {bundle.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </RadioGroup>
              </section>

              {/* Active filters */}
              <section>
                <Label className="text-sm font-semibold text-neutral-950">
                  Filters from dashboard
                </Label>
                <div className="mt-2 flex flex-wrap gap-2" data-testid="filter-chips">
                  {filterChips.length === 0 ? (
                    <span className="text-xs text-[#717182]" data-testid="text-no-filters">
                      No filters applied — exporting all trucks.
                    </span>
                  ) : (
                    filterChips.map((chip) => (
                      <Badge
                        key={chip.testId}
                        variant="secondary"
                        data-testid={chip.testId}
                      >
                        {chip.label}
                      </Badge>
                    ))
                  )}
                </div>
              </section>

              {/* Advanced — per-column checkboxes */}
              <section>
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 text-sm font-semibold text-neutral-950 hover-elevate rounded-md px-2 py-1 -mx-2"
                      data-testid="button-toggle-advanced"
                    >
                      {advancedOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      Advanced — choose columns
                      <span className="text-xs font-normal text-[#717182]">
                        ({selectedCount} selected)
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 space-y-4 border border-[#ebeef2] rounded-md p-4">
                    {COLUMN_GROUPS.map(({ group, columns }) => (
                      <div key={group} data-testid={`column-group-${slug(group)}`}>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#717182] mb-2">
                          {group}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                          {columns.map((col) => {
                            const key = col.key as ColumnKey;
                            const checked = selectedColumns.has(key);
                            return (
                              <label
                                key={key}
                                className="flex items-start gap-2 cursor-pointer"
                                data-testid={`column-row-${key}`}
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) => toggleColumn(key, v === true)}
                                  className="mt-0.5"
                                  data-testid={`checkbox-column-${key}`}
                                />
                                <div className="min-w-0">
                                  <div className="text-sm text-neutral-950">{col.label}</div>
                                  {col.description && (
                                    <div className="text-xs text-[#717182]">
                                      {col.description}
                                    </div>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              </section>
            </>
          )}

          {/* === HISTORICAL MODE === */}
          {mode === "historical" && (
            <>
              {/* Truck — searchable single-select combobox */}
              <section>
                <Label className="text-sm font-semibold text-neutral-950">Truck</Label>
                <TruckCombobox
                  trucks={trucks}
                  isLoading={trucksQuery.isLoading}
                  selectedId={historicalTruckId}
                  onSelect={setHistoricalTruckId}
                />
              </section>

              {/* Date range */}
              <section>
                <Label className="text-sm font-semibold text-neutral-950">Date range</Label>
                <div className="mt-2 flex flex-wrap gap-2" data-testid="range-presets">
                  {RANGE_PRESETS.map((p) => {
                    const active = rangePresetId === p.id;
                    return (
                      <Button
                        key={p.id}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => setRangePresetId(p.id)}
                        data-testid={`button-range-${p.id}`}
                      >
                        {p.label}
                      </Button>
                    );
                  })}
                  <Button
                    size="sm"
                    variant={rangePresetId === "custom" ? "default" : "outline"}
                    onClick={() => setRangePresetId("custom")}
                    data-testid="button-range-custom"
                  >
                    Custom
                  </Button>
                </div>
                {rangePresetId === "custom" && (
                  <CustomRangePicker
                    customStart={customStart}
                    customEnd={customEnd}
                    onChange={(s, e) => {
                      setCustomStart(s);
                      setCustomEnd(e);
                    }}
                  />
                )}
                {rangeError && (
                  <p className="mt-2 text-xs text-destructive" data-testid="text-range-error">
                    {rangeError}
                  </p>
                )}
              </section>

              {/* Granularity */}
              <section>
                <Label className="text-sm font-semibold text-neutral-950">Granularity</Label>
                <RadioGroup
                  value={granularity}
                  onValueChange={(v) => {
                    setGranularity(v as HistoricalGranularity);
                    setGranularityTouched(true);
                  }}
                  className="mt-3 space-y-2"
                  data-testid="radio-group-granularity"
                >
                  {HISTORICAL_GRANULARITIES.map((g) => {
                    const meta = HISTORICAL_GRANULARITY_META[g];
                    return (
                      <div
                        key={g}
                        className="flex items-start gap-3 rounded-md border border-[#ebeef2] p-3 hover-elevate"
                        data-testid={`granularity-option-${g}`}
                      >
                        <RadioGroupItem
                          value={g}
                          id={`granularity-${g}`}
                          className="mt-0.5"
                          data-testid={`radio-granularity-${g}`}
                        />
                        <div className="flex-1 min-w-0">
                          <Label
                            htmlFor={`granularity-${g}`}
                            className="text-sm font-medium text-neutral-950 cursor-pointer"
                          >
                            {meta.label}
                          </Label>
                          <p className="text-xs text-[#4a5565] mt-0.5">{meta.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </RadioGroup>
              </section>

              {/* Estimate */}
              {estimate && (
                <section
                  className="rounded-md border border-[#ebeef2] bg-[#f9fafb] p-3"
                  data-testid="historical-estimate"
                >
                  <p className="text-xs text-[#4a5565]">
                    Estimated{" "}
                    <strong className="text-neutral-950" data-testid="text-estimate-rows">
                      ≈ {estimate.rowCount.toLocaleString()} rows
                    </strong>{" "}
                    /{" "}
                    <strong className="text-neutral-950">
                      ≈ {(estimate.approxBytes / 1024 / 1024).toFixed(2)} MB
                    </strong>
                    {estimate.exceedsMaxRows && (
                      <span className="ml-2 text-destructive">
                        — too many rows. Try a coarser granularity or shorter range.
                      </span>
                    )}
                  </p>
                </section>
              )}
            </>
          )}

          {/* Format toggle (shared) */}
          <section>
            <Label className="text-sm font-semibold text-neutral-950">Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v === "xlsx" ? "xlsx" : "csv")}
              className="mt-3 flex gap-2"
              data-testid="radio-group-format"
            >
              <div className="flex items-center gap-2 rounded-md border border-[#ebeef2] px-3 py-2 hover-elevate flex-1">
                <RadioGroupItem value="csv" id="format-csv" data-testid="radio-format-csv" />
                <Label htmlFor="format-csv" className="text-sm cursor-pointer">CSV</Label>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-[#ebeef2] px-3 py-2 hover-elevate flex-1">
                <RadioGroupItem value="xlsx" id="format-xlsx" data-testid="radio-format-xlsx" />
                <Label htmlFor="format-xlsx" className="text-sm cursor-pointer">Excel (.xlsx)</Label>
              </div>
            </RadioGroup>
          </section>

          {submitError && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
              data-testid="text-submit-error"
            >
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive">{submitError}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="button-export-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitDisabled}
            data-testid="button-export-submit"
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isBundleKey(value: string): value is BundleKey {
  return value in EXPORT_BUNDLES;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Truck combobox — searchable single-select (Command + Popover).
// Replaces the former Shadcn Select so users with large fleets can type to
// filter instead of scrolling through every truck.
// ---------------------------------------------------------------------------
type TruckOption = { id: number; truckNumber: string };

function TruckCombobox({
  trucks,
  isLoading,
  selectedId,
  onSelect,
}: {
  trucks: TruckOption[];
  isLoading: boolean;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = selectedId != null
    ? trucks.find((t) => t.id === selectedId)
    : undefined;
  const placeholder = isLoading ? "Loading…" : "Pick a truck";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="mt-2 w-full justify-between font-normal"
          data-testid="select-historical-truck"
        >
          <span className={cn(!selected && "text-[#717182]")}>
            {selected ? selected.truckNumber : placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command>
          <CommandInput
            placeholder="Search trucks…"
            data-testid="input-truck-search"
          />
          <CommandList>
            <CommandEmpty>No trucks found.</CommandEmpty>
            <CommandGroup>
              {trucks.map((t) => (
                <CommandItem
                  key={t.id}
                  value={t.truckNumber}
                  onSelect={() => {
                    onSelect(t.id);
                    setOpen(false);
                  }}
                  data-testid={`select-truck-option-${t.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedId === t.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {t.truckNumber}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Custom date-range picker — single Calendar in range mode, opened from a
// trigger button that shows the current selection. Replaces the prior pair
// of <Input type="date"> fields so users get a real calendar interaction.
// Internally still drives the same `customStart` / `customEnd` ISO strings
// so the rest of the dialog logic is unchanged.
// ---------------------------------------------------------------------------
function CustomRangePicker({
  customStart,
  customEnd,
  onChange,
}: {
  customStart: string;
  customEnd: string;
  onChange: (start: string, end: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fromDate = customStart ? new Date(`${customStart}T00:00:00`) : undefined;
  const toDate = customEnd ? new Date(`${customEnd}T00:00:00`) : undefined;
  const selected: DateRange | undefined =
    fromDate || toDate ? { from: fromDate, to: toDate } : undefined;
  const buttonLabel = (() => {
    if (fromDate && toDate) {
      return `${formatDate(fromDate, "MMM d, yyyy")} → ${formatDate(toDate, "MMM d, yyyy")}`;
    }
    if (fromDate) return `${formatDate(fromDate, "MMM d, yyyy")} → …`;
    return "Pick a date range";
  })();
  return (
    <div className="mt-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start font-normal",
              !fromDate && "text-[#717182]",
            )}
            data-testid="button-custom-range"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {buttonLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={selected}
            onSelect={(range) => {
              const next: DateRange | undefined = range;
              const nextStart = next?.from ? isoDate(next.from) : "";
              const nextEnd = next?.to ? isoDate(next.to) : "";
              onChange(nextStart, nextEnd);
              if (next?.from && next?.to) setOpen(false);
            }}
            disabled={(date) => date > new Date()}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
