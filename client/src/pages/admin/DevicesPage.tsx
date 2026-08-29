import { useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminOrganizations,
  useAdminDevices,
  useAdminTrucks,
  useAllAdminTrucks,
  useCreateDevice,
  useUpdateDevice,
  useAssignDevice,
  useUnassignDevice,
  useDeleteDevice,
  useDeviceCredential,
  useCreateDeviceCredential,
  useUpdateDeviceCredential,
  useResetDeviceStatus,
  useSetDeviceOffline,
  useBackfillSimLinks,
  useRefreshDeviceSim,
  AdminApiError,
  type SimBackfillSummary,
  type RefreshSimResult,
} from "@/lib/admin-api";
import { useCreateAdminExport, useHistoricalSummary, type HistoricalSummaryResponse } from "@/lib/admin-exports-api";
import {
  HISTORICAL_GRANULARITY_META,
  HISTORICAL_MAX_RANGE_MS,
  HISTORICAL_MAX_ROWS,
  HISTORICAL_SYNC_MAX_RANGE_MS,
  estimateHistoricalRows,
  type HistoricalGranularity,
} from "@shared/export-historical";
import { StatCard, getSocStatus, getVoltageStatus, type StatCardStatus } from "@/components/StatCard";
import { format } from "date-fns";
import { Plus, Pencil, Cpu, Link2, Unlink, Key, Search, Trash2, RotateCcw, WifiOff, RefreshCw, AlertCircle, AlertTriangle, RotateCw, MoreHorizontal, Download, Loader2, Eye, ArrowLeft, Info } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PowerMonDevice, EquipmentSpecs } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";
import type { DeviceWithSnapshot } from "@/lib/admin-api";
import { SignalCell, classifySignal } from "@/components/SignalCell";
import { LocationCell } from "@/components/LocationCell";
import { MovementCell } from "@/components/MovementCell";
import { classifyFlappingVerdict } from "@shared/flapping-verdict";

// Returns the text actually shown in the Data Status pill, mirroring the render
// priority (verdict → probing → offline → disconnected → dataStatus). Used both
// for sorting (so identical pills group together) and the cell render.
function getDataStatusLabel(device: DeviceWithSnapshot): string {
  if (device.connectionStatus === "flapping" || device.connectionStatus === "unstable") {
    return classifyFlappingVerdict(device.routerSignalUpdatedAt, device.lastReportedAt).label;
  }
  if (device.connectionStatus === "probing") return "Probing";
  if (device.connectionStatus === "offline") return "Offline";
  if (device.connectionStatus === "disconnected") return "Disconnected";
  if (device.dataStatus === "reporting") return "Reporting";
  if (device.dataStatus === "stale") return "Stale";
  return "No data";
}

function SortIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g opacity="0.4">
        <path d="M12.2507 9.3335L9.91732 11.6668L7.58398 9.3335" stroke="white" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9.91602 11.6668V2.3335" stroke="white" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M1.75 4.66659L4.08333 2.33325L6.41667 4.66659" stroke="white" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M4.08398 2.3335V11.6668" stroke="white" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
    </svg>
  );
}

// Manually-entered equipment spec sheet (Inverter/Charge Controller/Solar/AGS/
// Generator/Cell Router) collected as flat strings in the form, then packed
// into the equipmentSpecs jsonb column on submit. Battery Volts/Ah/Qty are
// NOT here — they're pre-existing top-level columns on the device (feed the
// live kWh formula elsewhere) and stay in the page's main `formData` state;
// only Battery Mfg is new and lives in this form alongside them.
interface EquipmentForm {
  inverterMfg: string;
  inverterModel: string;
  inverterPowerW: string;
  chargeControllerMfg: string;
  chargeControllerModel: string;
  solarMfg: string;
  solarModel: string;
  solarWattsEach: string;
  solarQty: string;
  batteryMfg: string;
  agsSetpoints: string;
  generatorNotes: string;
  cellRouterIccid: string;
  cellRouterMsisdn: string;
}

const emptyEquipmentForm: EquipmentForm = {
  inverterMfg: "",
  inverterModel: "",
  inverterPowerW: "",
  chargeControllerMfg: "",
  chargeControllerModel: "",
  solarMfg: "",
  solarModel: "",
  solarWattsEach: "",
  solarQty: "",
  batteryMfg: "",
  agsSetpoints: "",
  generatorNotes: "",
  cellRouterIccid: "",
  cellRouterMsisdn: "",
};

function equipmentSpecsToForm(specs: EquipmentSpecs | null | undefined): EquipmentForm {
  return {
    inverterMfg: specs?.inverter?.mfg || "",
    inverterModel: specs?.inverter?.model || "",
    inverterPowerW: specs?.inverter?.powerW?.toString() || "",
    chargeControllerMfg: specs?.chargeController?.mfg || "",
    chargeControllerModel: specs?.chargeController?.model || "",
    solarMfg: specs?.solarPanels?.mfg || "",
    solarModel: specs?.solarPanels?.model || "",
    solarWattsEach: specs?.solarPanels?.wattsEach?.toString() || "",
    solarQty: specs?.solarPanels?.qty?.toString() || "",
    batteryMfg: specs?.battery?.mfg || "",
    agsSetpoints: specs?.ags?.setpoints || "",
    generatorNotes: specs?.generator?.notes || "",
    cellRouterIccid: specs?.cellRouter?.iccid || "",
    cellRouterMsisdn: specs?.cellRouter?.msisdn || "",
  };
}

// Only sets a group's key when it has at least one non-empty field, so
// clearing every field in a section removes it from the stored JSON rather
// than leaving behind an object of empty strings.
function compact<T extends Record<string, string | number | undefined>>(obj: T): Partial<T> | undefined {
  const out: Partial<T> = {};
  (Object.keys(obj) as (keyof T)[]).forEach((key) => {
    if (obj[key] !== undefined) out[key] = obj[key];
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function formToEquipmentSpecs(form: EquipmentForm): EquipmentSpecs {
  const str = (s: string): string | undefined => s.trim() || undefined;
  const num = (s: string): number | undefined => (s.trim() ? Number(s) : undefined);

  const specs: EquipmentSpecs = {};
  const inverter = compact({ mfg: str(form.inverterMfg), model: str(form.inverterModel), powerW: num(form.inverterPowerW) });
  if (inverter) specs.inverter = inverter;
  const chargeController = compact({ mfg: str(form.chargeControllerMfg), model: str(form.chargeControllerModel) });
  if (chargeController) specs.chargeController = chargeController;
  const solarPanels = compact({ mfg: str(form.solarMfg), model: str(form.solarModel), wattsEach: num(form.solarWattsEach), qty: num(form.solarQty) });
  if (solarPanels) specs.solarPanels = solarPanels;
  const battery = compact({ mfg: str(form.batteryMfg) });
  if (battery) specs.battery = battery;
  const ags = compact({ setpoints: str(form.agsSetpoints) });
  if (ags) specs.ags = ags;
  const generator = compact({ notes: str(form.generatorNotes) });
  if (generator) specs.generator = generator;
  const cellRouter = compact({ iccid: str(form.cellRouterIccid), msisdn: str(form.cellRouterMsisdn) });
  if (cellRouter) specs.cellRouter = cellRouter;
  return specs;
}

function EquipmentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <h4 className="text-sm font-semibold mb-3">{title}</h4>
      {children}
    </div>
  );
}

function EquipmentInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Input
        id={id}
        type={type}
        step={type === "number" ? "any" : undefined}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="mt-1"
        data-testid={`input-${id}`}
      />
    </div>
  );
}

function EquipmentComputed({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input disabled className="mt-1 bg-muted" value={value !== null ? value.toLocaleString() : ""} placeholder="—" />
    </div>
  );
}

// Shared by the Register Device and Edit Device dialogs so both stay in sync
// with the same grouping/layout instead of duplicating ~130 lines of JSX.
function EquipmentSpecsFields({
  idPrefix,
  equipment,
  onEquipmentChange,
  batteryVoltage,
  batteryAh,
  numberOfBatteries,
  onBatteryFieldChange,
}: {
  idPrefix: string;
  equipment: EquipmentForm;
  onEquipmentChange: (next: EquipmentForm) => void;
  batteryVoltage: string;
  batteryAh: string;
  numberOfBatteries: string;
  onBatteryFieldChange: (field: "batteryVoltage" | "batteryAh" | "numberOfBatteries", value: string) => void;
}) {
  const set = (field: keyof EquipmentForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onEquipmentChange({ ...equipment, [field]: e.target.value });

  const wattsEach = parseFloat(equipment.solarWattsEach);
  const solarQty = parseFloat(equipment.solarQty);
  const totalW = Number.isFinite(wattsEach) && Number.isFinite(solarQty) ? wattsEach * solarQty : null;

  const volts = parseFloat(batteryVoltage);
  const ah = parseFloat(batteryAh);
  const numBatteries = parseFloat(numberOfBatteries);
  const capacityKwh = Number.isFinite(volts) && Number.isFinite(ah) && Number.isFinite(numBatteries)
    ? Math.round((volts * ah * numBatteries) / 10) / 100
    : null;

  return (
    <div className="space-y-3">
      <EquipmentSection title="Inverter">
        <div className="grid grid-cols-3 gap-3">
          <EquipmentInput id={`${idPrefix}-inverter-mfg`} label="Mfg" value={equipment.inverterMfg} onChange={set("inverterMfg")} />
          <EquipmentInput id={`${idPrefix}-inverter-model`} label="Model" value={equipment.inverterModel} onChange={set("inverterModel")} />
          <EquipmentInput id={`${idPrefix}-inverter-power`} label="Power (W)" type="number" value={equipment.inverterPowerW} onChange={set("inverterPowerW")} />
        </div>
      </EquipmentSection>

      <EquipmentSection title="Solar Charge Controller">
        <div className="grid grid-cols-3 gap-3">
          <EquipmentInput id={`${idPrefix}-scc-mfg`} label="Mfg" value={equipment.chargeControllerMfg} onChange={set("chargeControllerMfg")} />
          <EquipmentInput id={`${idPrefix}-scc-model`} label="Model" value={equipment.chargeControllerModel} onChange={set("chargeControllerModel")} />
        </div>
      </EquipmentSection>

      <EquipmentSection title="Solar PV Panels">
        <div className="grid grid-cols-3 gap-3">
          <EquipmentInput id={`${idPrefix}-solar-mfg`} label="Mfg" value={equipment.solarMfg} onChange={set("solarMfg")} />
          <EquipmentInput id={`${idPrefix}-solar-model`} label="Model" value={equipment.solarModel} onChange={set("solarModel")} />
          <EquipmentInput id={`${idPrefix}-solar-watts`} label="W ea" type="number" value={equipment.solarWattsEach} onChange={set("solarWattsEach")} />
          <EquipmentInput id={`${idPrefix}-solar-qty`} label="Qty" type="number" value={equipment.solarQty} onChange={set("solarQty")} />
          <EquipmentComputed label="Total W" value={totalW} />
        </div>
      </EquipmentSection>

      <EquipmentSection title="Battery">
        <div className="grid grid-cols-3 gap-3">
          <EquipmentInput id={`${idPrefix}-battery-mfg`} label="Mfg" value={equipment.batteryMfg} onChange={set("batteryMfg")} />
          <EquipmentInput
            id={`${idPrefix}-battery-volts`}
            label="Volts"
            type="number"
            value={batteryVoltage}
            onChange={(e) => onBatteryFieldChange("batteryVoltage", e.target.value)}
          />
          <EquipmentInput
            id={`${idPrefix}-battery-ahr`}
            label="Ahr"
            type="number"
            value={batteryAh}
            onChange={(e) => onBatteryFieldChange("batteryAh", e.target.value)}
          />
          <EquipmentInput
            id={`${idPrefix}-battery-qty`}
            label="Qty"
            type="number"
            value={numberOfBatteries}
            onChange={(e) => onBatteryFieldChange("numberOfBatteries", e.target.value)}
          />
          <EquipmentComputed label="kWh" value={capacityKwh} />
        </div>
      </EquipmentSection>

      <EquipmentSection title="AGS">
        <div>
          <Label htmlFor={`${idPrefix}-ags-setpoints`} className="text-xs text-muted-foreground">Setpoints</Label>
          <Textarea
            id={`${idPrefix}-ags-setpoints`}
            value={equipment.agsSetpoints}
            onChange={(e) => onEquipmentChange({ ...equipment, agsSetpoints: e.target.value })}
            placeholder="e.g. Start 40% / Stop 90%"
            className="mt-1"
            rows={2}
            data-testid={`input-${idPrefix}-ags-setpoints`}
          />
        </div>
      </EquipmentSection>

      <EquipmentSection title="Generator">
        <div>
          <Label htmlFor={`${idPrefix}-generator-notes`} className="text-xs text-muted-foreground">Notes</Label>
          <Textarea
            id={`${idPrefix}-generator-notes`}
            value={equipment.generatorNotes}
            onChange={(e) => onEquipmentChange({ ...equipment, generatorNotes: e.target.value })}
            placeholder="Mfg, model, and any other details"
            className="mt-1"
            rows={2}
            data-testid={`input-${idPrefix}-generator-notes`}
          />
        </div>
      </EquipmentSection>

      <EquipmentSection title="Cell Router">
        <div className="grid grid-cols-3 gap-3">
          <EquipmentInput id={`${idPrefix}-cell-iccid`} label="ICCID" value={equipment.cellRouterIccid} onChange={set("cellRouterIccid")} />
          <EquipmentInput id={`${idPrefix}-cell-msisdn`} label="MSISDN" value={equipment.cellRouterMsisdn} onChange={set("cellRouterMsisdn")} />
        </div>
      </EquipmentSection>
    </div>
  );
}

export default function DevicesPage() {
  const { toast } = useToast();
  const { data: orgsData } = useAdminOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState<number | undefined>();
  const { data: devicesData, isLoading } = useAdminDevices(selectedOrgId);
  const { data: trucksData } = useAdminTrucks(selectedOrgId);
  const { data: allTrucksData } = useAllAdminTrucks();
  const createDevice = useCreateDevice();
  const updateDevice = useUpdateDevice();
  const assignDevice = useAssignDevice();
  const unassignDevice = useUnassignDevice();
  const deleteDevice = useDeleteDevice();
  const resetDeviceStatus = useResetDeviceStatus();
  const setDeviceOffline = useSetDeviceOffline();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Inline error shown inside the Register Device dialog so the operator
  // can fix the device name (or duplicate cleanup) without losing the form.
  const [createError, setCreateError] = useState<{ code?: string; message: string } | null>(null);
  const backfillSimLinks = useBackfillSimLinks();
  const [backfillSummary, setBackfillSummary] = useState<SimBackfillSummary | null>(null);
  const refreshDeviceSim = useRefreshDeviceSim();
  const [refreshingDeviceId, setRefreshingDeviceId] = useState<number | null>(null);
  const [refreshResult, setRefreshResult] = useState<RefreshSimResult | null>(null);
  const [editingDevice, setEditingDevice] = useState<PowerMonDevice | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<PowerMonDevice | null>(null);
  const [assigningDevice, setAssigningDevice] = useState<PowerMonDevice | null>(null);
  const [credentialsDevice, setCredentialsDevice] = useState<PowerMonDevice | null>(null);
  const [exportingDevice, setExportingDevice] = useState<PowerMonDevice | null>(null);
  const [viewingDevice, setViewingDevice] = useState<PowerMonDevice | null>(null);
  const [equipmentForm, setEquipmentForm] = useState<EquipmentForm>(emptyEquipmentForm);
  const [selectedTruckId, setSelectedTruckId] = useState<number | undefined>();
  const [applinkUrl, setApplinkUrl] = useState("");
  
  const { data: credentialData, isLoading: isCredentialLoading, error: credentialError } = useDeviceCredential(
    credentialsDevice?.id,
    credentialsDevice?.organizationId
  );
  const createCredential = useCreateDeviceCredential();
  const updateCredential = useUpdateDeviceCredential();

  const [formData, setFormData] = useState({
    serialNumber: "",
    deviceName: "",
    hardwareRevision: "",
    firmwareVersion: "",
    batteryVoltage: "25.6",
    batteryAh: "200",
    numberOfBatteries: "2",
    status: "offline",
  });

  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const resetForm = () => {
    setFormData({
      serialNumber: "",
      deviceName: "",
      hardwareRevision: "",
      firmwareVersion: "",
      batteryVoltage: "25.6",
      batteryAh: "200",
      numberOfBatteries: "2",
      status: "offline",
    });
    setEquipmentForm(emptyEquipmentForm);
  };

  const handleBatteryFieldChange = (field: "batteryVoltage" | "batteryAh" | "numberOfBatteries", value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };


  const handleCreate = async () => {
    if (!selectedOrgId) return;
    setCreateError(null);
    try {
      const specs = formToEquipmentSpecs(equipmentForm);
      const data = {
        ...formData,
        batteryVoltage: formData.batteryVoltage ? parseFloat(formData.batteryVoltage) : null,
        batteryAh: formData.batteryAh ? parseFloat(formData.batteryAh) : null,
        numberOfBatteries: formData.numberOfBatteries ? parseInt(formData.numberOfBatteries) : null,
        equipmentSpecs: Object.keys(specs).length > 0 ? specs : null,
      };
      const response = await createDevice.mutateAsync({ orgId: selectedOrgId, data });
      toast({
        title: "Device registered",
        description: response.message
          || (response.sim
            ? `Linked to SIM ICCID ${response.sim.iccid} (${response.sim.msisdn}).`
            : undefined),
      });
      setIsCreateOpen(false);
      resetForm();
    } catch (error: any) {
      const code = error instanceof AdminApiError ? error.code : undefined;
      const message = error?.message || "Failed to register device";
      // Keep the dialog open for fixable lookup errors so the operator can
      // correct the device name and retry without re-entering everything.
      if (
        code === "SIM_NOT_FOUND"
        || code === "SIM_MULTIPLE_MATCH"
        || code === "SIM_ALREADY_LINKED"
        || code === "DEVICE_NAME_REQUIRED"
      ) {
        setCreateError({ code, message });
        return;
      }
      toast({ title: message, variant: "destructive" });
    }
  };

  const handleBackfill = async () => {
    try {
      const summary = await backfillSimLinks.mutateAsync();
      setBackfillSummary(summary);
    } catch (error: any) {
      toast({ title: error?.message || "Backfill failed", variant: "destructive" });
    }
  };

  const handleRefreshSim = async (device: PowerMonDevice) => {
    setRefreshingDeviceId(device.id);
    try {
      const result = await refreshDeviceSim.mutateAsync(device.id);
      setRefreshResult(result);
    } catch (error: any) {
      toast({
        title: error?.message || "Failed to refresh SIM",
        variant: "destructive",
      });
    } finally {
      setRefreshingDeviceId(null);
    }
  };

  const handleUpdate = async () => {
    if (!editingDevice) return;
    const orgId = editingDevice.organizationId;
    try {
      const specs = formToEquipmentSpecs(equipmentForm);
      const data = {
        ...formData,
        batteryVoltage: formData.batteryVoltage ? parseFloat(formData.batteryVoltage) : null,
        batteryAh: formData.batteryAh ? parseFloat(formData.batteryAh) : null,
        numberOfBatteries: formData.numberOfBatteries ? parseInt(formData.numberOfBatteries) : null,
        equipmentSpecs: Object.keys(specs).length > 0 ? specs : null,
      };
      await updateDevice.mutateAsync({ id: editingDevice.id, orgId, data });
      toast({ title: "Device updated successfully" });
      setEditingDevice(null);
      resetForm();
    } catch (error) {
      toast({ title: "Failed to update device", variant: "destructive" });
    }
  };

  const handleAssign = async () => {
    if (!assigningDevice || !selectedTruckId) return;
    try {
      await assignDevice.mutateAsync({ id: assigningDevice.id, truckId: selectedTruckId, organizationId: assigningDevice.organizationId });
      toast({ title: "Device assigned to truck" });
      setAssigningDevice(null);
      setSelectedTruckId(undefined);
    } catch (error) {
      toast({ title: "Failed to assign device", variant: "destructive" });
    }
  };

  const handleUnassign = async (device: PowerMonDevice) => {
    try {
      await unassignDevice.mutateAsync({ id: device.id, organizationId: device.organizationId });
      toast({ title: "Device unassigned from truck" });
    } catch (error) {
      toast({ title: "Failed to unassign device", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deletingDevice) return;
    try {
      await deleteDevice.mutateAsync({ id: deletingDevice.id, organizationId: deletingDevice.organizationId });
      toast({ title: "Device deleted successfully" });
      setDeletingDevice(null);
    } catch (error) {
      toast({ title: "Failed to delete device", variant: "destructive" });
    }
  };

  const handleResetStatus = async (device: PowerMonDevice) => {
    try {
      await resetDeviceStatus.mutateAsync({ id: device.id });
      toast({ title: `Device "${device.deviceName || device.serialNumber}" set back online` });
    } catch (error) {
      toast({ title: "Failed to reset device status", variant: "destructive" });
    }
  };

  const handleSetOffline = async (device: PowerMonDevice) => {
    try {
      await setDeviceOffline.mutateAsync({ id: device.id });
      toast({ title: `Device "${device.deviceName || device.serialNumber}" set to offline` });
    } catch (error) {
      toast({ title: "Failed to set device offline", variant: "destructive" });
    }
  };

  const openCredentials = (device: PowerMonDevice) => {
    setApplinkUrl("");
    setCredentialsDevice(device);
  };

  const handleSaveCredentials = async () => {
    if (!credentialsDevice || !applinkUrl.trim()) return;
    
    try {
      const hasExisting = credentialData?.credential;
      if (hasExisting) {
        await updateCredential.mutateAsync({
          deviceId: credentialsDevice.id,
          organizationId: credentialsDevice.organizationId,
          applinkUrl: applinkUrl.trim(),
        });
        toast({ title: "PowerMon URL updated" });
      } else {
        await createCredential.mutateAsync({
          deviceId: credentialsDevice.id,
          organizationId: credentialsDevice.organizationId,
          applinkUrl: applinkUrl.trim(),
        });
        toast({ title: "PowerMon URL saved" });
      }
      setCredentialsDevice(null);
      setApplinkUrl("");
    } catch (error: any) {
      toast({ title: error?.message || "Failed to save credentials", variant: "destructive" });
    }
  };

  const openEdit = (device: PowerMonDevice) => {
    setFormData({
      serialNumber: device.serialNumber || "",
      deviceName: device.deviceName || "",
      hardwareRevision: device.hardwareRevision || "",
      firmwareVersion: device.firmwareVersion || "",
      batteryVoltage: device.batteryVoltage?.toString() || "",
      batteryAh: device.batteryAh?.toString() || "",
      numberOfBatteries: device.numberOfBatteries?.toString() || "",
      status: device.status || "offline",
    });
    setEquipmentForm(equipmentSpecsToForm(device.equipmentSpecs));
    setEditingDevice(device);
  };

  const organizations = orgsData?.organizations || [];
  const rawDevices = devicesData?.devices || [];
  const allTrucks = allTrucksData?.trucks || [];

  const filteredDevices = rawDevices.filter((device) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const truckNumber = device.truckId 
      ? allTrucks.find(t => t.id === device.truckId)?.truckNumber?.toLowerCase() || ""
      : "";
    return (
      device.serialNumber?.toLowerCase().includes(query) ||
      device.deviceName?.toLowerCase().includes(query) ||
      device.firmwareVersion?.toLowerCase().includes(query) ||
      truckNumber.includes(query)
    );
  });

  const getTruckNumber = (truckId: number | null) => {
    if (!truckId) return "";
    return allTrucks.find(t => t.id === truckId)?.truckNumber?.toLowerCase() || "";
  };

  const getOrganizationName = (orgId: number | null) => {
    if (!orgId) return "";
    return organizations.find(o => o.id === orgId)?.name?.toLowerCase() || "";
  };

  const devices = [...filteredDevices].sort((a, b) => {
    if (!sortField) return 0;
    let aVal: string | number | Date | null = null;
    let bVal: string | number | Date | null = null;
    
    switch (sortField) {
      case "deviceName":
        aVal = a.deviceName?.toLowerCase() || "";
        bVal = b.deviceName?.toLowerCase() || "";
        break;
      case "serialNumber":
        aVal = a.serialNumber?.toLowerCase() || "";
        bVal = b.serialNumber?.toLowerCase() || "";
        break;
      case "firmwareVersion":
        aVal = a.firmwareVersion || "";
        bVal = b.firmwareVersion || "";
        break;
      case "connectionStatus":
        aVal = a.connectionStatus || "";
        bVal = b.connectionStatus || "";
        break;
      case "dataStatus":
        // Sort by the *displayed* pill text, not the raw dataStatus column, so
        // identical pills group together (e.g. all "Router/cellular outage"
        // rows stay together instead of mixing with "No data" rows that share
        // the same underlying dataStatus). Mirrors the render priority below.
        aVal = getDataStatusLabel(a).toLowerCase();
        bVal = getDataStatusLabel(b).toLowerCase();
        break;
      case "organization":
        aVal = getOrganizationName(a.organizationId);
        bVal = getOrganizationName(b.organizationId);
        break;
      case "assignedTruck":
        aVal = getTruckNumber(a.truckId);
        bVal = getTruckNumber(b.truckId);
        break;
      case "lastSeenAt":
        aVal = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
        bVal = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
        break;
      case "lastReportedAt":
        aVal = a.lastReportedAt ? new Date(a.lastReportedAt).getTime() : 0;
        bVal = b.lastReportedAt ? new Date(b.lastReportedAt).getTime() : 0;
        break;
      case "soc":
        aVal = a.snapshot?.soc ?? -1;
        bVal = b.snapshot?.soc ?? -1;
        break;
      case "temperature":
        aVal = a.snapshot?.temperature ?? -999;
        bVal = b.snapshot?.temperature ?? -999;
        break;
      case "rssi": {
        // Unknowns (null or PowerMon -32768 "no reading" sentinel) always
        // sort to the bottom regardless of direction — matches how SignalCell
        // shows them as "—" and keeps "no data" rows out of the way.
        const aUnknown = classifySignal(a.snapshot?.rssi ?? null) === "unknown";
        const bUnknown = classifySignal(b.snapshot?.rssi ?? null) === "unknown";
        if (aUnknown && bUnknown) return 0;
        if (aUnknown) return 1;
        if (bUnknown) return -1;
        aVal = a.snapshot?.rssi as number;
        bVal = b.snapshot?.rssi as number;
        break;
      }
      case "routerRssi": {
        const aUnknown = classifySignal(a.routerRssi ?? null) === "unknown";
        const bUnknown = classifySignal(b.routerRssi ?? null) === "unknown";
        if (aUnknown && bUnknown) return 0;
        if (aUnknown) return 1;
        if (bUnknown) return -1;
        aVal = a.routerRssi as number;
        bVal = b.routerRssi as number;
        break;
      }
      default:
        return 0;
    }
    
    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });
  const trucks = selectedOrgId ? (trucksData?.trucks || []) : allTrucks;
  const unassignedTrucks = trucks.filter(t => !devices.some(d => d.truckId === t.id));
  
  // For the assign dialog, filter trucks to only show trucks from the device's organization
  const trucksForAssignDialog = assigningDevice 
    ? allTrucks.filter(t => t.organizationId === assigningDevice.organizationId && !devices.some(d => d.truckId === t.id))
    : [];

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              Devices
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Register and manage PowerMon devices
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleBackfill}
              disabled={backfillSimLinks.isPending}
              data-testid="button-backfill-sim-links"
              title="Look up SIMs in Wireless Logic for any devices that don't yet have one linked."
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${backfillSimLinks.isPending ? "animate-spin" : ""}`} />
              {backfillSimLinks.isPending ? "Backfilling..." : "Backfill SIM Links"}
            </Button>
            <Button
              onClick={() => { setCreateError(null); setIsCreateOpen(true); }}
              disabled={!selectedOrgId}
              data-testid="button-create-device"
            >
              <Plus className="h-4 w-4 mr-2" />
              Register Device
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Label htmlFor="org-select" className="whitespace-nowrap">Organization:</Label>
                <Select 
                  value={selectedOrgId?.toString() || "all"} 
                  onValueChange={(v) => setSelectedOrgId(v === "all" ? undefined : parseInt(v))}
                >
                  <SelectTrigger className="w-64" data-testid="select-organization">
                    <SelectValue placeholder="All organizations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All organizations</SelectItem>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id.toString()}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="relative w-[293px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#9c9ca7]" />
                <input
                  type="text"
                  placeholder="Search for something"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-white border border-[#ebeef2] rounded-lg text-sm text-neutral-950 placeholder:text-[#9c9ca7] focus:outline-none focus:ring-1 focus:ring-[#ebeef2]"
                  data-testid="input-search-devices"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : devices.length === 0 ? (
              <div className="p-8 text-center">
                <Cpu className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No devices registered</p>
                {selectedOrgId && (
                  <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
                    Register your first device
                  </Button>
                )}
              </div>
            ) : (
              <div>
                <Table wrapperClassName="max-h-[calc(100vh-280px)]">
                  <TableHeader className="bg-[#303030] sticky top-0 z-20">
                    <TableRow className="hover:bg-[#303030] border-0">
                      <TableHead 
                        className="text-white font-medium cursor-pointer select-none"
                        onClick={() => handleSort("deviceName")}
                        data-testid="sort-serial-name"
                      >
                        <div className="flex items-center gap-1.5">
                          Serial Number - Name
                          <SortIcon />
                        </div>
                      </TableHead>
                      {!selectedOrgId && (
                        <TableHead 
                          className="text-white font-medium cursor-pointer select-none"
                          onClick={() => handleSort("organization")}
                          data-testid="sort-organization"
                        >
                          <div className="flex items-center gap-1.5">
                            Organization
                            <SortIcon />
                          </div>
                        </TableHead>
                      )}
                      <TableHead 
                        className="text-white font-medium cursor-pointer select-none"
                        onClick={() => handleSort("assignedTruck")}
                        data-testid="sort-assigned-truck"
                      >
                        <div className="flex items-center gap-1.5">
                          Assigned Truck
                          <SortIcon />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-white font-medium cursor-pointer select-none"
                        onClick={() => handleSort("dataStatus")}
                        data-testid="sort-data-status"
                      >
                        <div className="flex items-center gap-1.5">
                          Data Status
                          <SortIcon />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-white font-medium cursor-pointer select-none"
                        onClick={() => handleSort("lastReportedAt")}
                        data-testid="sort-last-reported"
                      >
                        <div className="flex items-center gap-1.5">
                          Last Reported
                          <SortIcon />
                        </div>
                      </TableHead>
                      <TableHead className="text-white font-medium text-center">V1</TableHead>
                      <TableHead 
                        className="text-white font-medium text-center cursor-pointer select-none"
                        onClick={() => handleSort("soc")}
                        data-testid="sort-soc"
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          SoC (%)
                          <SortIcon />
                        </div>
                      </TableHead>
                      <TableHead className="text-white font-medium text-center">V2</TableHead>
                      <TableHead className="text-white font-medium text-center">P (W)</TableHead>
                      <TableHead className="text-white font-medium text-center">kWh</TableHead>
                      <TableHead 
                        className="text-white font-medium text-center cursor-pointer select-none"
                        onClick={() => handleSort("temperature")}
                        data-testid="sort-temp"
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          Temp (°F)
                          <SortIcon />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-white font-medium text-center cursor-pointer select-none"
                        onClick={() => handleSort("routerRssi")}
                        data-testid="sort-router-rssi"
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          Router Sig
                          <SortIcon />
                        </div>
                      </TableHead>
                      <TableHead className="text-white font-medium">Location</TableHead>
                      <TableHead className="text-white font-medium">Moved (24h)</TableHead>
                      <TableHead className="text-white font-medium text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices.map((device, index) => {
                      const snapshot = device.snapshot;
                      const soc = snapshot?.soc;
                      const tempF = snapshot?.temperature !== null && snapshot?.temperature !== undefined
                        ? ((snapshot.temperature * 9/5) + 32).toFixed(1)
                        : null;
                      
                      // Calculate kWh on-the-fly using current device battery settings
                      // This ensures edits to battery config are reflected immediately
                      // Formula: kWh = (SoC/100) × batteryVoltage × (numberOfBatteries × batteryAh) / 1000
                      const calculatedKwh = (
                        soc != null &&
                        device.batteryVoltage != null &&
                        device.numberOfBatteries != null &&
                        device.batteryAh != null
                      ) ? ((soc / 100) * device.batteryVoltage * (device.numberOfBatteries * device.batteryAh) / 1000)
                        : null;
                      
                      return (
                        <TableRow 
                          key={device.id} 
                          data-testid={`row-device-${device.id}`}
                          className={index % 2 === 1 ? "bg-[#fafbfc]" : "bg-white"}
                        >
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-mono text-xs font-medium text-foreground">{device.serialNumber}</span>
                              <span className="text-xs text-muted-foreground">{device.deviceName || "-"}</span>
                            </div>
                          </TableCell>
                          {!selectedOrgId && (
                            <TableCell>
                              <span className="text-sm text-foreground max-w-[120px] inline-block break-words leading-tight">
                                {organizations.find(o => o.id === device.organizationId)?.name || "-"}
                              </span>
                            </TableCell>
                          )}
                          <TableCell>
                            {device.truckId ? (
                              <Badge variant="outline" className="bg-white border-[#d9d9d9] text-[#303030]">
                                {trucks.find(t => t.id === device.truckId)?.truckNumber || `Truck #${device.truckId}`}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {(() => {
                              if (device.connectionStatus === "flapping" || device.connectionStatus === "unstable") {
                                const verdict = classifyFlappingVerdict(
                                  device.routerSignalUpdatedAt,
                                  device.lastReportedAt,
                                );
                                // Color by verdict bucket: outage/flap = red, powermon_offline = orange.
                                const cls = verdict.bucket === "powermon_offline"
                                  ? "bg-[rgba(255,165,0,0.14)] border-[#ffa500] text-[#cc8400]"
                                  : "bg-[rgba(255,0,0,0.08)] border-[#ff4444] text-[#cc0000]";
                                return (
                                  <div
                                    className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md border text-xs font-normal whitespace-nowrap ${cls}`}
                                    title={verdict.tooltip}
                                    data-testid={`status-verdict-${device.id}`}
                                  >
                                    {verdict.label}
                                  </div>
                                );
                              }

                              if (device.connectionStatus === "probing") {
                                return (
                                  <div className="inline-flex items-center justify-center px-3 py-1.5 rounded-md border text-xs font-normal bg-[rgba(59,130,246,0.08)] border-[#3b82f6] text-[#2563eb] dark:text-[#60a5fa]">
                                    Probing
                                  </div>
                                );
                              }

                              if (device.connectionStatus === "offline") {
                                return (
                                  <div className="inline-flex items-center justify-center px-3 py-1.5 rounded-md border text-xs font-normal bg-[#ededed] border-[#c0c0c0] text-[#9e9e9e]">
                                    Offline
                                  </div>
                                );
                              }

                              if (device.connectionStatus === "disconnected") {
                                return (
                                  <div className="inline-flex items-center justify-center px-3 py-1.5 rounded-md border text-xs font-normal bg-[rgba(255,165,0,0.14)] border-[#ffa500] text-[#cc8400]">
                                    Disconnected
                                  </div>
                                );
                              }
                              
                              return (
                                <div className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md border text-xs font-normal ${
                                  device.dataStatus === "reporting" 
                                    ? "bg-[rgba(0,201,80,0.14)] border-[#00c950] text-[#00953b]" 
                                    : device.dataStatus === "stale"
                                    ? "bg-[rgba(255,165,0,0.14)] border-[#ffa500] text-[#cc8400]"
                                    : "bg-[#ededed] border-[#c0c0c0] text-[#9e9e9e]"
                                }`}>
                                  {device.dataStatus === "reporting" ? "Reporting" 
                                    : device.dataStatus === "stale" ? "Stale"
                                    : "No data"}
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {device.lastReportedAt ? (
                              <div className="leading-tight">
                                <div>{new Date(device.lastReportedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}</div>
                                <div>{new Date(device.lastReportedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}</div>
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {snapshot?.voltage1?.toFixed(2) ?? "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            {soc !== null && soc !== undefined ? (
                              <span className={`text-sm font-semibold ${
                                soc >= 50 ? "text-[#39c900]" : soc >= 20 ? "text-[#ff9500]" : "text-[#ff0900]"
                              }`}>
                                {Math.round(soc)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {snapshot?.voltage2?.toFixed(2) ?? "-"}
                          </TableCell>
                          <TableCell className={`text-center ${
                            snapshot?.power != null 
                              ? snapshot.power < 0 
                                ? "text-red-600" 
                                : snapshot.power > 0 
                                  ? "text-green-600" 
                                  : "text-muted-foreground"
                              : "text-muted-foreground"
                          }`}>
                            {snapshot?.power != null ? snapshot.power.toFixed(1) : "-"}
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {calculatedKwh != null ? calculatedKwh.toFixed(2) : "-"}
                          </TableCell>
                          <TableCell className="text-center font-medium">
                            {tempF ?? "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            <SignalCell
                              rssi={device.routerRssi}
                              testId={`router-signal-${device.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <LocationCell
                              latitude={device.latitude}
                              longitude={device.longitude}
                              locationDescription={device.locationDescription}
                              lastLocationUpdate={device.lastLocationUpdate}
                              testId={`location-${device.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <MovementCell
                              miles={device.movementMiles24h}
                              testId={`movement-${device.id}`}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    data-testid={`button-actions-device-${device.id}`}
                                    title="Device actions"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-52">
                                  <DropdownMenuItem
                                    onClick={() => setViewingDevice(device)}
                                    data-testid={`button-view-details-device-${device.id}`}
                                  >
                                    <Info className="h-4 w-4 text-blue-600" />
                                    View Details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => openEdit(device)}
                                    data-testid={`button-edit-device-${device.id}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                    Edit device
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => openCredentials(device)}
                                    data-testid={`button-credentials-device-${device.id}`}
                                  >
                                    <Key className="h-4 w-4 text-purple-600" />
                                    Manage PowerMon URL
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {device.truckId ? (
                                    <DropdownMenuItem
                                      onClick={() => handleUnassign(device)}
                                      data-testid={`button-unassign-device-${device.id}`}
                                    >
                                      <Unlink className="h-4 w-4 text-orange-600" />
                                      Unassign truck
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={() => setAssigningDevice(device)}
                                      disabled={allTrucks.filter(t => t.organizationId === device.organizationId && !devices.some(d => d.truckId === t.id)).length === 0}
                                      data-testid={`button-assign-device-${device.id}`}
                                    >
                                      <Link2 className="h-4 w-4 text-blue-600" />
                                      Assign truck
                                    </DropdownMenuItem>
                                  )}
                                  {(device.connectionStatus === "unstable" || device.connectionStatus === "offline" || device.connectionStatus === "flapping" || device.connectionStatus === "probing") ? (
                                    <DropdownMenuItem
                                      onClick={() => handleResetStatus(device)}
                                      disabled={resetDeviceStatus.isPending}
                                      data-testid={`button-reset-device-${device.id}`}
                                    >
                                      <RotateCcw className="h-4 w-4 text-green-600" />
                                      Set online
                                    </DropdownMenuItem>
                                  ) : (device.connectionStatus !== "disconnected") && (
                                    <DropdownMenuItem
                                      onClick={() => handleSetOffline(device)}
                                      disabled={setDeviceOffline.isPending}
                                      data-testid={`button-offline-device-${device.id}`}
                                    >
                                      <WifiOff className="h-4 w-4 text-orange-600" />
                                      Set offline
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    onClick={() => handleRefreshSim(device)}
                                    disabled={refreshingDeviceId === device.id}
                                    data-testid={`button-refresh-sim-${device.id}`}
                                  >
                                    <RotateCw className={`h-4 w-4 text-blue-600 ${refreshingDeviceId === device.id ? "animate-spin" : ""}`} />
                                    Refresh SIM
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setExportingDevice(device)}
                                    disabled={!device.truckId}
                                    data-testid={`button-export-device-${device.id}`}
                                  >
                                    <Download className="h-4 w-4 text-blue-600" />
                                    Export
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => setDeletingDevice(device)}
                                    data-testid={`button-delete-device-${device.id}`}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4 text-red-600" />
                                    Delete device
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) setCreateError(null); }}>
          <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 overflow-hidden sm:max-w-2xl">
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
              <DialogTitle>Register Device</DialogTitle>
              <DialogDescription>
                Add a new PowerMon device. The device name must already exist in Wireless Logic (Custom Field 1) — its SIM is looked up and linked at registration. Serial number, firmware, and hardware revision auto-populate when the device connects.
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {createError && (
                <div
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                  data-testid="alert-create-error"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">
                      {createError.code === "SIM_NOT_FOUND" && "SIM not found in Wireless Logic"}
                      {createError.code === "SIM_MULTIPLE_MATCH" && "Multiple SIMs match this name"}
                      {createError.code === "SIM_ALREADY_LINKED" && "SIM already linked to another device"}
                      {createError.code === "DEVICE_NAME_REQUIRED" && "Device name required"}
                    </div>
                    <div className="text-xs mt-0.5 opacity-90">{createError.message}</div>
                  </div>
                </div>
              )}
              <div>
                <Label htmlFor="deviceName">Device Name <span className="text-destructive">*</span></Label>
                <Input
                  id="deviceName"
                  value={formData.deviceName}
                  onChange={(e) => setFormData({ ...formData, deviceName: e.target.value })}
                  placeholder="PowerMon Unit 1"
                  data-testid="input-device-name"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Must match Custom Field 1 of an existing SIM in Wireless Logic.
                </p>
              </div>

              <EquipmentSpecsFields
                idPrefix="create"
                equipment={equipmentForm}
                onEquipmentChange={setEquipmentForm}
                batteryVoltage={formData.batteryVoltage}
                batteryAh={formData.batteryAh}
                numberOfBatteries={formData.numberOfBatteries}
                onBatteryFieldChange={handleBatteryFieldChange}
              />
            </div>
            <DialogFooter className="shrink-0 border-t px-6 py-4">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createDevice.isPending} data-testid="button-submit-create">
                {createDevice.isPending ? "Registering..." : "Register"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editingDevice} onOpenChange={() => setEditingDevice(null)}>
          <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 overflow-hidden sm:max-w-2xl">
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
              <DialogTitle>Edit Device</DialogTitle>
              <DialogDescription>
                Update device details.
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <Label htmlFor="edit-serialNumber">Serial Number</Label>
                <Input
                  id="edit-serialNumber"
                  value={editingDevice?.serialNumber || ""}
                  disabled
                  className="bg-muted"
                />
              </div>
              <div>
                <Label htmlFor="edit-deviceName">Device Name</Label>
                <Input
                  id="edit-deviceName"
                  value={formData.deviceName}
                  onChange={(e) => setFormData({ ...formData, deviceName: e.target.value })}
                  data-testid="input-edit-device-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-hardwareRevision">Hardware Revision</Label>
                  <Input
                    id="edit-hardwareRevision"
                    value={formData.hardwareRevision}
                    onChange={(e) => setFormData({ ...formData, hardwareRevision: e.target.value })}
                    data-testid="input-edit-hardware-rev"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-firmwareVersion">Firmware Version</Label>
                  <Input
                    id="edit-firmwareVersion"
                    value={formData.firmwareVersion}
                    onChange={(e) => setFormData({ ...formData, firmwareVersion: e.target.value })}
                    data-testid="input-edit-firmware-version"
                  />
                </div>
              </div>

              <EquipmentSpecsFields
                idPrefix="edit"
                equipment={equipmentForm}
                onEquipmentChange={setEquipmentForm}
                batteryVoltage={formData.batteryVoltage}
                batteryAh={formData.batteryAh}
                numberOfBatteries={formData.numberOfBatteries}
                onBatteryFieldChange={handleBatteryFieldChange}
              />
            </div>
            <DialogFooter className="shrink-0 border-t px-6 py-4">
              <Button variant="outline" onClick={() => setEditingDevice(null)}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={updateDevice.isPending} data-testid="button-submit-update">
                {updateDevice.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!assigningDevice} onOpenChange={() => setAssigningDevice(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Device to Truck</DialogTitle>
              <DialogDescription>
                Link device "{assigningDevice?.serialNumber || assigningDevice?.deviceName || `Device #${assigningDevice?.id}`}" to a truck.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="truck-select">Select Truck</Label>
                <Select value={selectedTruckId?.toString()} onValueChange={(v) => setSelectedTruckId(parseInt(v))}>
                  <SelectTrigger data-testid="select-assign-truck">
                    <SelectValue placeholder="Select a truck" />
                  </SelectTrigger>
                  <SelectContent>
                    {trucksForAssignDialog.map((truck) => (
                      <SelectItem key={truck.id} value={truck.id.toString()}>
                        {truck.truckNumber} - {truck.driverName || "No driver"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssigningDevice(null)}>
                Cancel
              </Button>
              <Button onClick={handleAssign} disabled={assignDevice.isPending || !selectedTruckId} data-testid="button-submit-assign">
                {assignDevice.isPending ? "Assigning..." : "Assign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!credentialsDevice} onOpenChange={() => { setCredentialsDevice(null); setApplinkUrl(""); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>PowerMon Connection URL</DialogTitle>
              <DialogDescription>
                Manage the connection URL for device "{credentialsDevice?.serialNumber}".
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {isCredentialLoading ? (
                <div className="text-muted-foreground text-sm">Loading...</div>
              ) : (
                <>
                  {credentialData?.credential && (
                    <div className="bg-muted p-3 rounded-md space-y-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Current URL</Label>
                        <p className="font-mono text-sm break-all mt-1">
                          {credentialData.credential.applinkUrl || "Not set"}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <Label className="text-xs text-muted-foreground">Monitoring</Label>
                          <p className="text-sm mt-0.5">
                            {credentialData.credential.isActive ? (
                              <span className="text-green-700 font-medium">On</span>
                            ) : (
                              <span className="text-[#636363] font-medium">Off</span>
                            )}
                          </p>
                        </div>
                        <Button
                          variant={credentialData.credential.isActive ? "outline" : "default"}
                          size="sm"
                          data-testid="button-toggle-monitoring"
                          disabled={updateCredential.isPending}
                          onClick={async () => {
                            try {
                              await updateCredential.mutateAsync({
                                deviceId: credentialsDevice!.id,
                                organizationId: credentialsDevice!.organizationId,
                                isActive: !credentialData.credential.isActive,
                              });
                              toast({ 
                                title: credentialData.credential.isActive 
                                  ? "Monitoring turned off" 
                                  : "Monitoring turned on" 
                              });
                            } catch {
                              toast({ title: "Failed to update monitoring", variant: "destructive" });
                            }
                          }}
                        >
                          {credentialData.credential.isActive ? "Turn Off" : "Turn On"}
                        </Button>
                      </div>
                    </div>
                  )}
                  {!credentialData?.credential && !credentialError && (
                    <div className="bg-muted p-3 rounded-md">
                      <p className="text-sm text-muted-foreground">No connection URL configured yet.</p>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="applinkUrl">
                      {credentialData?.credential ? "Update URL" : "PowerMon URL"}
                    </Label>
                    <Input
                      id="applinkUrl"
                      value={applinkUrl}
                      onChange={(e) => setApplinkUrl(e.target.value)}
                      placeholder="powermon://accessKey@connectionKey"
                      className="font-mono text-sm mt-1"
                      data-testid="input-applink-url"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Format: powermon://accessKey@connectionKey
                    </p>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCredentialsDevice(null); setApplinkUrl(""); }}>
                Cancel
              </Button>
              <Button 
                onClick={handleSaveCredentials} 
                disabled={createCredential.isPending || updateCredential.isPending || !applinkUrl.trim()} 
                data-testid="button-submit-credentials"
              >
                {createCredential.isPending || updateCredential.isPending 
                  ? "Saving..." 
                  : credentialData?.credential ? "Update" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {exportingDevice && (
          <DeviceExportDialog
            device={exportingDevice}
            truckNumber={allTrucks.find((t) => t.id === exportingDevice.truckId)?.truckNumber ?? `Truck #${exportingDevice.truckId}`}
            onClose={() => setExportingDevice(null)}
          />
        )}

        {viewingDevice && (
          <DeviceDetailsDialog
            device={viewingDevice}
            organizationName={organizations.find((o) => o.id === viewingDevice.organizationId)?.name}
            truckNumber={viewingDevice.truckId ? allTrucks.find((t) => t.id === viewingDevice.truckId)?.truckNumber : undefined}
            onEdit={() => { openEdit(viewingDevice); setViewingDevice(null); }}
            onClose={() => setViewingDevice(null)}
          />
        )}

        <Dialog open={!!deletingDevice} onOpenChange={() => setDeletingDevice(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Device</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this device? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {deletingDevice && (
              <div className="py-4">
                <p className="text-sm">
                  <span className="font-medium">Serial Number:</span> {deletingDevice.serialNumber}
                </p>
                {deletingDevice.deviceName && (
                  <p className="text-sm">
                    <span className="font-medium">Name:</span> {deletingDevice.deviceName}
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeletingDevice(null)}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDelete} 
                disabled={deleteDevice.isPending}
                data-testid="button-confirm-delete"
              >
                {deleteDevice.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!refreshResult} onOpenChange={() => setRefreshResult(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>SIM Refreshed</DialogTitle>
              <DialogDescription>
                {refreshResult?.message}
              </DialogDescription>
            </DialogHeader>
            {refreshResult && (
              <div className="space-y-3 text-sm" data-testid="refresh-sim-summary">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground mb-1">Device</div>
                  <div className="font-mono text-sm">{refreshResult.device.deviceName}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground mb-1">Before</div>
                    {refreshResult.before ? (
                      <div className="font-mono text-xs leading-relaxed break-all">
                        <div><span className="text-muted-foreground">ICCID:</span> {refreshResult.before.iccid}</div>
                        <div><span className="text-muted-foreground">MSISDN:</span> {refreshResult.before.msisdn ?? "-"}</div>
                        <div><span className="text-muted-foreground">IMSI:</span> {refreshResult.before.imsi ?? "-"}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic">(no SIM linked)</div>
                    )}
                  </div>
                  <div className={`rounded-md border p-2 ${refreshResult.iccidChanged ? "border-primary/50 bg-primary/5" : ""}`}>
                    <div className="text-xs text-muted-foreground mb-1">After</div>
                    <div className="font-mono text-xs leading-relaxed break-all">
                      <div><span className="text-muted-foreground">ICCID:</span> {refreshResult.after.iccid}</div>
                      <div><span className="text-muted-foreground">MSISDN:</span> {refreshResult.after.msisdn ?? "-"}</div>
                      <div><span className="text-muted-foreground">IMSI:</span> {refreshResult.after.imsi ?? "-"}</div>
                    </div>
                  </div>
                </div>
                {refreshResult.iccidChanged && (
                  <div className="text-xs text-muted-foreground">
                    Router signal will start populating within ~2 min once the InHand poller matches the new identifiers.
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => setRefreshResult(null)} data-testid="button-close-refresh-result">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!backfillSummary} onOpenChange={() => setBackfillSummary(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>SIM Backfill Complete</DialogTitle>
              <DialogDescription>
                Looked up unmatched devices in Wireless Logic and linked the SIMs that have a unique Custom Field 1 match.
              </DialogDescription>
            </DialogHeader>
            {backfillSummary && (
              <div className="space-y-3 text-sm" data-testid="backfill-summary">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">Devices scanned</div>
                    <div className="text-lg font-semibold">{backfillSummary.scanned}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">SIMs linked</div>
                    <div className="text-lg font-semibold text-primary">{backfillSummary.linked}</div>
                  </div>
                </div>
                {backfillSummary.failed_no_match.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">No SIM found ({backfillSummary.failed_no_match.length})</div>
                    <div className="rounded-md border p-2 max-h-32 overflow-auto text-xs font-mono">
                      {backfillSummary.failed_no_match.join(", ")}
                    </div>
                  </div>
                )}
                {backfillSummary.failed_multiple_match.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">Multiple matches — clean up duplicates ({backfillSummary.failed_multiple_match.length})</div>
                    <div className="rounded-md border p-2 max-h-32 overflow-auto text-xs font-mono">
                      {backfillSummary.failed_multiple_match.join(", ")}
                    </div>
                  </div>
                )}
                {backfillSummary.failed_already_linked.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">SIM already linked to another device ({backfillSummary.failed_already_linked.length})</div>
                    <div className="rounded-md border p-2 max-h-32 overflow-auto text-xs font-mono">
                      {backfillSummary.failed_already_linked.map((e, i) => (<div key={i}>{e}</div>))}
                    </div>
                  </div>
                )}
                {backfillSummary.skipped_no_name.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">Skipped (no device name) ({backfillSummary.skipped_no_name.length})</div>
                    <div className="rounded-md border p-2 max-h-24 overflow-auto text-xs font-mono">
                      {backfillSummary.skipped_no_name.join(", ")}
                    </div>
                  </div>
                )}
                {backfillSummary.failed_api_error.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1 text-destructive">API/DB errors ({backfillSummary.failed_api_error.length})</div>
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 max-h-32 overflow-auto text-xs font-mono">
                      {backfillSummary.failed_api_error.map((e, i) => (
                        <div key={i}>{e.name}: {e.error}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => setBackfillSummary(null)} data-testid="button-close-backfill-summary">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------------------
// Row-menu export dialog
// ---------------------------------------------------------------------------

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

function SummaryMetricRow({
  label,
  unit,
  decimals,
  metric,
  statusFn,
  caption,
}: {
  label: string;
  unit: string;
  decimals: number;
  metric: { avg: number | null; min: number | null; max: number | null };
  statusFn?: (value: number) => StatCardStatus;
  caption?: string;
}) {
  if (metric.avg === null && metric.min === null && metric.max === null) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-sm font-medium text-neutral-950">{label}</p>
        {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          compact
          title="Min"
          targetNumber={metric.min ?? 0}
          suffix={unit}
          decimals={decimals}
          status={metric.min !== null ? statusFn?.(metric.min) : undefined}
        />
        <StatCard
          compact
          title="Average"
          targetNumber={metric.avg ?? 0}
          suffix={unit}
          decimals={decimals}
          status={metric.avg !== null ? statusFn?.(metric.avg) : undefined}
        />
        <StatCard
          compact
          title="Max"
          targetNumber={metric.max ?? 0}
          suffix={unit}
          decimals={decimals}
          status={metric.max !== null ? statusFn?.(metric.max) : undefined}
        />
      </div>
    </div>
  );
}

function HistoricalSummaryResults({ result }: { result: HistoricalSummaryResponse }) {
  const { summary } = result;
  const periodLabel = `${format(new Date(summary.startTime), "MMM d, yyyy")} – ${format(new Date(summary.endTime), "MMM d, yyyy")}`;
  const socCaption =
    summary.soc.start !== null && summary.soc.end !== null
      ? `${summary.soc.start.toFixed(0)}% → ${summary.soc.end.toFixed(0)}%`
      : undefined;

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground" data-testid="text-summary-period">
        {periodLabel} · {summary.dataPoints.toLocaleString()} data points ({HISTORICAL_GRANULARITY_META[summary.granularity].label.toLowerCase()})
      </div>

      <SummaryMetricRow label="State of Charge" unit="%" decimals={0} metric={summary.soc} statusFn={getSocStatus} caption={socCaption} />
      <SummaryMetricRow label="Voltage 1 (Chassis)" unit="V" decimals={2} metric={summary.voltage1} statusFn={getVoltageStatus} />
      {summary.voltage2 && (
        <SummaryMetricRow label="Voltage 2 (Sleeper)" unit="V" decimals={2} metric={summary.voltage2} />
      )}
      <SummaryMetricRow label="Current" unit="A" decimals={1} metric={summary.current} />
      <SummaryMetricRow label="Power" unit="W" decimals={1} metric={summary.power} />
      {summary.temperatureF && (
        <SummaryMetricRow label="Temperature" unit="°F" decimals={1} metric={summary.temperatureF} />
      )}

      {summary.totalKwh !== null && (
        <div>
          <p className="text-sm font-medium text-neutral-950 mb-1.5">Energy Throughput</p>
          <div className="w-1/3">
            <StatCard compact title="Total" targetNumber={summary.totalKwh} suffix=" kWh" decimals={1} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders a sync-cap range like `HISTORICAL_SYNC_MAX_RANGE_MS.minute` as "14 days" / "1 year". */
function formatSyncRangeLimit(ms: number): string {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return `${days} days`;
}

function SpecRow({ label, value }: { label: string; value?: string | number | null }) {
  const display = value === undefined || value === null || value === "" ? "—" : value;
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm leading-tight">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{display}</span>
    </div>
  );
}

// Compact section wrapper for the read-only Device Details dialog only —
// deliberately separate from EquipmentSection (used by the Register/Edit
// forms) so tightening this spacing can't affect the input dialogs. Sections
// sit in a 2-col dense grid; pass className="col-span-2" for the ones with
// enough rows (Solar PV Panels, Battery) that need the full width.
function DetailsSection({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-md border border-border p-2.5 ${className ?? ""}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</h4>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// Read-only counterpart to EquipmentSpecsFields, opened via the row's "View
// Details" action — same category grouping/order so the two stay visually
// consistent with each other and with the reference spreadsheet layout.
function DeviceDetailsDialog({
  device,
  organizationName,
  truckNumber,
  onEdit,
  onClose,
}: {
  device: PowerMonDevice;
  organizationName?: string;
  truckNumber?: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  const specs = device.equipmentSpecs || {};
  const wattsEach = specs.solarPanels?.wattsEach;
  const solarQty = specs.solarPanels?.qty;
  const totalW = wattsEach != null && solarQty != null ? wattsEach * solarQty : null;

  const volts = device.batteryVoltage;
  const ah = device.batteryAh;
  const numBatteries = device.numberOfBatteries;
  const capacityKwh = volts != null && ah != null && numBatteries != null
    ? Math.round((volts * ah * numBatteries) / 10) / 100
    : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Device Details</DialogTitle>
          <DialogDescription>
            {[organizationName, truckNumber ? `Truck ${truckNumber}` : null, device.serialNumber || device.deviceName || `Device #${device.id}`]
              .filter(Boolean)
              .join(" · ")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-2 [grid-auto-flow:dense]">
            <DetailsSection title="Device">
              <SpecRow label="Device Name" value={device.deviceName} />
              <SpecRow label="Serial Number" value={device.serialNumber} />
              <SpecRow label="Hardware Revision" value={device.hardwareRevision} />
              <SpecRow label="Firmware Version" value={device.firmwareVersion} />
            </DetailsSection>

            <DetailsSection title="Inverter">
              <SpecRow label="Mfg" value={specs.inverter?.mfg} />
              <SpecRow label="Model" value={specs.inverter?.model} />
              <SpecRow label="Power" value={specs.inverter?.powerW != null ? `${specs.inverter.powerW} W` : null} />
            </DetailsSection>

            <DetailsSection title="Solar Charge Controller">
              <SpecRow label="Mfg" value={specs.chargeController?.mfg} />
              <SpecRow label="Model" value={specs.chargeController?.model} />
            </DetailsSection>

            <DetailsSection title="AGS">
              <SpecRow label="Setpoints" value={specs.ags?.setpoints} />
            </DetailsSection>

            <DetailsSection title="Solar PV Panels" className="col-span-2">
              <SpecRow label="Mfg" value={specs.solarPanels?.mfg} />
              <SpecRow label="Model" value={specs.solarPanels?.model} />
              <SpecRow label="W ea" value={wattsEach} />
              <SpecRow label="Qty" value={solarQty} />
              <SpecRow label="Total W" value={totalW} />
            </DetailsSection>

            <DetailsSection title="Battery" className="col-span-2">
              <SpecRow label="Mfg" value={specs.battery?.mfg} />
              <SpecRow label="Volts" value={volts} />
              <SpecRow label="Ahr" value={ah} />
              <SpecRow label="Qty" value={numBatteries} />
              <SpecRow label="kWh" value={capacityKwh} />
            </DetailsSection>

            <DetailsSection title="Generator">
              <SpecRow label="Notes" value={specs.generator?.notes} />
            </DetailsSection>

            <DetailsSection title="Cell Router">
              <SpecRow label="ICCID" value={specs.cellRouter?.iccid} />
              <SpecRow label="MSISDN" value={specs.cellRouter?.msisdn} />
            </DetailsSection>
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={onClose} data-testid="button-details-close">
            Close
          </Button>
          <Button onClick={onEdit} data-testid="button-details-edit">
            <Pencil className="h-4 w-4 mr-2" />
            Edit Details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Same historical-export payload/validation as the Export tab's
 * `HistoricalForm`, trimmed to start/end date + granularity + format since
 * the organization and truck are already known from the row this was
 * opened from. Queuing (Download File) submits via the same job as before,
 * so progress shows up in the top-right ExportsBanner notification. View on
 * Screen instead calls a synchronous summary endpoint that reuses the exact
 * same historical query, and renders the result in place of the form.
 */
function DeviceExportDialog({
  device,
  truckNumber,
  onClose,
}: {
  device: PowerMonDevice;
  truckNumber: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const create = useCreateAdminExport();
  const viewSummary = useHistoricalSummary();

  const [mode, setMode] = useState<"download" | "view">("download");
  const [startDate, setStartDate] = useState<string>(() => isoLocalDate(new Date(Date.now() - 7 * 86400000)));
  const [endDate, setEndDate] = useState<string>(() => isoLocalDate(new Date()));
  const [granularity, setGranularity] = useState<HistoricalGranularity>("hour");
  const [format2, setFormat] = useState<"csv" | "xlsx">("csv");

  const startMs = startDate ? startOfDayLocal(new Date(startDate)).getTime() : NaN;
  const endMs = endDate ? endOfDayLocal(new Date(endDate)).getTime() : NaN;
  const validRange =
    Number.isFinite(startMs)
    && Number.isFinite(endMs)
    && endMs > startMs
    && endMs - startMs <= HISTORICAL_MAX_RANGE_MS;

  const estimate = validRange ? estimateHistoricalRows({ startMs, endMs, granularity }) : null;
  const tooManyRows = !!estimate && estimate.exceedsMaxRows;
  const rangeTooLong =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs > HISTORICAL_MAX_RANGE_MS;

  const submitDownload = async () => {
    if (!device.truckId || !validRange) return;
    try {
      await create.mutateAsync({
        kind: "historical",
        format: format2,
        organizationId: device.organizationId,
        truckId: device.truckId,
        granularity,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
      });
      toast({
        title: "Export queued",
        description: "Track progress in the notification in the top-right corner.",
      });
      onClose();
    } catch (e) {
      const err = e as { message?: string };
      toast({
        title: "Could not queue export",
        description: err?.message ?? "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const submitView = async () => {
    if (!device.truckId || !validRange) return;
    try {
      await viewSummary.mutateAsync({
        organizationId: device.organizationId,
        truckId: device.truckId,
        granularity,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
      });
    } catch (e) {
      const err = e as { message?: string };
      toast({
        title: "Could not load summary",
        description: err?.message ?? "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const submit = mode === "download" ? submitDownload : submitView;
  const isPending = mode === "download" ? create.isPending : viewSummary.isPending;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Export Truck History</DialogTitle>
          <DialogDescription>
            {truckNumber} · {device.serialNumber || device.deviceName || `Device #${device.id}`}
          </DialogDescription>
        </DialogHeader>

        {viewSummary.data ? (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <HistoricalSummaryResults result={viewSummary.data} />
            </div>
            <DialogFooter className="shrink-0 border-t px-6 py-4">
              <Button variant="outline" onClick={() => viewSummary.reset()} data-testid="button-summary-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={onClose} data-testid="button-summary-close">
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              <div>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as "download" | "view")}
                  className="grid grid-cols-2 gap-2"
                >
                  <Label
                    htmlFor="device-export-mode-download"
                    className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover-elevate"
                  >
                    <RadioGroupItem value="download" id="device-export-mode-download" data-testid="radio-device-export-mode-download" />
                    <Download className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-medium">Download File</span>
                  </Label>
                  <Label
                    htmlFor="device-export-mode-view"
                    className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover-elevate"
                  >
                    <RadioGroupItem value="view" id="device-export-mode-view" data-testid="radio-device-export-mode-view" />
                    <Eye className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-medium">View on Screen</span>
                  </Label>
                </RadioGroup>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground" htmlFor="device-export-start">Start date</Label>
                  <Input
                    id="device-export-start"
                    type="date"
                    className="mt-1"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="input-device-export-start"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground" htmlFor="device-export-end">End date</Label>
                  <Input
                    id="device-export-end"
                    type="date"
                    className="mt-1"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="input-device-export-end"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Granularity</Label>
                <RadioGroup
                  value={granularity}
                  onValueChange={(v) => setGranularity(v as HistoricalGranularity)}
                  className="mt-2 space-y-2"
                >
                  {(Object.keys(HISTORICAL_GRANULARITY_META) as HistoricalGranularity[]).map((g) => {
                    const meta = HISTORICAL_GRANULARITY_META[g];
                    return (
                      <Label
                        key={g}
                        htmlFor={`device-export-gran-${g}`}
                        className="flex items-start gap-3 cursor-pointer rounded-md border border-border px-3 py-2 hover-elevate"
                      >
                        <RadioGroupItem value={g} id={`device-export-gran-${g}`} data-testid={`radio-device-export-granularity-${g}`} />
                        <div className="flex-1">
                          <div className="text-sm font-medium">{meta.label}</div>
                          <div className="text-xs text-muted-foreground">{meta.description}</div>
                        </div>
                      </Label>
                    );
                  })}
                </RadioGroup>
              </div>

              {mode === "view" && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3" data-testid="text-device-export-sync-limits">
                  <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
                  <div className="text-xs">
                    <div className="font-medium text-foreground">On-screen summaries are limited to:</div>
                    <div className="mt-1.5 space-y-0.5">
                      {(Object.keys(HISTORICAL_GRANULARITY_META) as HistoricalGranularity[]).map((g) => {
                        const isActive = g === granularity;
                        return (
                          <div
                            key={g}
                            className={`flex justify-between ${isActive ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                          >
                            <span>{HISTORICAL_GRANULARITY_META[g].label}</span>
                            <span>{formatSyncRangeLimit(HISTORICAL_SYNC_MAX_RANGE_MS[g])}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-1.5 text-muted-foreground">For longer ranges, use Download File.</div>
                  </div>
                </div>
              )}

              {mode === "download" && (
                <div>
                  <Label className="text-xs text-muted-foreground">Format</Label>
                  <RadioGroup
                    value={format2}
                    onValueChange={(v) => setFormat(v as "csv" | "xlsx")}
                    className="flex gap-4 mt-2"
                  >
                    <Label htmlFor="device-export-fmt-csv" className="flex items-center gap-2 cursor-pointer">
                      <RadioGroupItem value="csv" id="device-export-fmt-csv" data-testid="radio-device-export-format-csv" />
                      <span className="text-sm">CSV</span>
                    </Label>
                    <Label htmlFor="device-export-fmt-xlsx" className="flex items-center gap-2 cursor-pointer">
                      <RadioGroupItem value="xlsx" id="device-export-fmt-xlsx" data-testid="radio-device-export-format-xlsx" />
                      <span className="text-sm">Excel (.xlsx)</span>
                    </Label>
                  </RadioGroup>
                </div>
              )}

              {rangeTooLong && (
                <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-device-export-range-error">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>Range cannot exceed 1 year.</span>
                </div>
              )}
              {tooManyRows && (
                <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-device-export-rows-error">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Estimated {estimate!.rowCount.toLocaleString()} rows exceeds the {HISTORICAL_MAX_ROWS.toLocaleString()} row
                    cap. Choose a coarser granularity or shorter range.
                  </span>
                </div>
              )}
              {mode === "download" && create.error && (
                <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-device-export-error">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{create.error.message}</span>
                </div>
              )}
              {mode === "view" && viewSummary.error && (
                <div className="flex items-start gap-2 text-sm text-destructive" data-testid="text-device-export-view-error">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{viewSummary.error.message}</span>
                </div>
              )}
            </div>
            <DialogFooter className="shrink-0 border-t px-6 py-4">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={!validRange || tooManyRows || isPending}
                data-testid="button-submit-device-export"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {mode === "download" ? "Queuing…" : "Loading…"}
                  </>
                ) : mode === "download" ? (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Queue export
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    View Summary
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
