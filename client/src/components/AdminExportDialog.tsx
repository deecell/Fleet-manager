import { useState, useEffect } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateAdminExport } from "@/lib/admin-exports-api";
import type { CreateExportJobError } from "@/lib/exports-api";

interface AdminExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently selected org filter on DevicesPage; null = "All organizations". */
  organizationId: number | null;
  /** Display name for the selected org, used in the filter summary. */
  organizationName: string | null;
  /** Free-text search applied on the page. Empty string = no search. */
  searchQuery: string;
}

/**
 * Admin Devices export dialog. Mirrors the customer ExportDialog UX (format
 * radio + filter summary + Cancel/Export buttons) but talks to the admin
 * endpoint and hands the same filters the user sees on DevicesPage straight
 * to the backend so the download matches what's on screen.
 */
export function AdminExportDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
  searchQuery,
}: AdminExportDialogProps) {
  const { toast } = useToast();
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const createExport = useCreateAdminExport();

  // Reset transient state whenever the dialog reopens so a previous error
  // doesn't follow the user into the next attempt.
  useEffect(() => {
    if (open) {
      setErrorBanner(null);
      setFormat("csv");
    }
  }, [open]);

  const trimmedSearch = searchQuery.trim();
  const filterSummary = buildFilterSummary({
    organizationName,
    searchQuery: trimmedSearch,
  });

  const handleSubmit = async () => {
    setErrorBanner(null);
    try {
      await createExport.mutateAsync({
        kind: "devices",
        format,
        organizationId: organizationId ?? null,
        searchQuery: trimmedSearch.length > 0 ? trimmedSearch : null,
      });
      toast({
        title: "Export started",
        description: "We'll email you a download link when it's ready.",
      });
      onOpenChange(false);
    } catch (e) {
      const err = e as CreateExportJobError;
      setErrorBanner(err.message || "Failed to start export");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-admin-export">
        <DialogHeader>
          <DialogTitle>Export Devices</DialogTitle>
          <DialogDescription>
            Generate a CSV or Excel file of every device matching your current
            filters. We'll email you a download link when it's ready.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">Filters</p>
            <p
              className="text-sm text-foreground mt-0.5"
              data-testid="text-admin-export-filter-summary"
            >
              {filterSummary}
            </p>
          </div>

          <div>
            <Label className="text-sm font-medium">Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as "csv" | "xlsx")}
              className="mt-2 flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="csv"
                  id="admin-export-format-csv"
                  data-testid="radio-admin-export-csv"
                />
                <Label htmlFor="admin-export-format-csv" className="cursor-pointer">
                  CSV
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="xlsx"
                  id="admin-export-format-xlsx"
                  data-testid="radio-admin-export-xlsx"
                />
                <Label htmlFor="admin-export-format-xlsx" className="cursor-pointer">
                  Excel
                </Label>
              </div>
            </RadioGroup>
          </div>

          {errorBanner && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="text-admin-export-error"
            >
              {errorBanner}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createExport.isPending}
            data-testid="button-admin-export-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createExport.isPending}
            data-testid="button-admin-export-submit"
          >
            {createExport.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting...
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

function buildFilterSummary(opts: {
  organizationName: string | null;
  searchQuery: string;
}): string {
  const parts: string[] = [];
  parts.push(opts.organizationName ? `Org: ${opts.organizationName}` : "All organizations");
  if (opts.searchQuery) parts.push(`Search: "${opts.searchQuery}"`);
  return parts.join(" · ");
}
