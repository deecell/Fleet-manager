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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  BUNDLE_KEYS,
  EXPORT_BUNDLES,
  EXPORT_COLUMN_LIST,
  type BundleKey,
  type ColumnKey,
} from "@shared/export-columns";
import {
  useCreateExport,
  type CreateExportJobError,
  type ExportJobFilters,
} from "@/lib/exports-api";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filters currently applied on the dashboard. Read-only here. */
  filters: ExportDialogFilters;
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

export function ExportDialog({ open, onOpenChange, filters }: ExportDialogProps) {
  const { toast } = useToast();
  const createExport = useCreateExport();

  const [bundleKey, setBundleKey] = useState<BundleKey>("default");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<Set<ColumnKey>>(
    () => new Set(EXPORT_BUNDLES.default.columnKeys as ColumnKey[]),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  // When dialog opens, reset to a clean state. (Filters can change between
  // opens, so we don't persist user's last picks across sessions.)
  useEffect(() => {
    if (!open) return;
    setBundleKey("default");
    setFormat("csv");
    setSelectedColumns(new Set(EXPORT_BUNDLES.default.columnKeys as ColumnKey[]));
    setAdvancedOpen(false);
    setSubmitError(null);
  }, [open]);

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

  const handleSubmit = async () => {
    setSubmitError(null);
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
      const e = err as CreateExportJobError;
      setSubmitError(e.message);
      // Non-limit failures also get a toast so the user sees something even
      // if the dialog is closed via outside-click. Limit (429) errors stay
      // inline because the action is "wait for one to finish".
      if (e.status !== 429) {
        toast({
          title: "Export failed",
          description: e.message,
          variant: "destructive",
        });
      }
    }
  };

  const submitting = createExport.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="dialog-export"
      >
        <DialogHeader>
          <DialogTitle data-testid="text-export-title">Export Fleet Data</DialogTitle>
          <DialogDescription>
            Pick a column bundle and format. We'll process the export in the
            background and email you a download link when it's ready.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
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

          {/* Format toggle */}
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
            disabled={submitting || selectedCount === 0}
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
