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
} from "@/lib/admin-api";
import { Plus, Pencil, Cpu, Link2, Unlink, Key, Search, Trash2, RotateCcw, WifiOff, Download } from "lucide-react";
import type { PowerMonDevice } from "@shared/schema";
import type { DeviceWithSnapshot } from "@/lib/admin-api";
import { AdminExportDialog } from "@/components/AdminExportDialog";
import { AdminTruckHistoryExportDialog } from "@/components/AdminTruckHistoryExportDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  const [editingDevice, setEditingDevice] = useState<PowerMonDevice | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<PowerMonDevice | null>(null);
  const [assigningDevice, setAssigningDevice] = useState<PowerMonDevice | null>(null);
  const [credentialsDevice, setCredentialsDevice] = useState<PowerMonDevice | null>(null);
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
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [historyExportDevice, setHistoryExportDevice] = useState<DeviceWithSnapshot | null>(null);

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
  };


  const handleCreate = async () => {
    if (!selectedOrgId) return;
    try {
      const data = {
        ...formData,
        batteryVoltage: formData.batteryVoltage ? parseFloat(formData.batteryVoltage) : null,
        batteryAh: formData.batteryAh ? parseFloat(formData.batteryAh) : null,
        numberOfBatteries: formData.numberOfBatteries ? parseInt(formData.numberOfBatteries) : null,
      };
      await createDevice.mutateAsync({ orgId: selectedOrgId, data });
      toast({ title: "Device registered successfully" });
      setIsCreateOpen(false);
      resetForm();
    } catch (error: any) {
      toast({ title: error?.message || "Failed to register device", variant: "destructive" });
    }
  };

  const handleUpdate = async () => {
    if (!editingDevice) return;
    const orgId = editingDevice.organizationId;
    try {
      const data = {
        ...formData,
        batteryVoltage: formData.batteryVoltage ? parseFloat(formData.batteryVoltage) : null,
        batteryAh: formData.batteryAh ? parseFloat(formData.batteryAh) : null,
        numberOfBatteries: formData.numberOfBatteries ? parseInt(formData.numberOfBatteries) : null,
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
        aVal = a.dataStatus || "";
        bVal = b.dataStatus || "";
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
              onClick={() => setIsExportOpen(true)}
              data-testid="button-export-devices"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button 
              onClick={() => setIsCreateOpen(true)} 
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
                              if (device.connectionStatus === "no_power") {
                                return (
                                  <div className="inline-flex items-center justify-center px-3 py-1.5 rounded-md border text-xs font-normal bg-[rgba(255,0,0,0.08)] border-[#ff4444] text-[#cc0000]">
                                    No Power
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
                              
                              if (device.connectionStatus === "weak_signal") {
                                return (
                                  <div className="inline-flex items-center justify-center px-3 py-1.5 rounded-md border text-xs font-normal bg-[rgba(255,200,0,0.14)] border-[#e6b800] text-[#b38f00]">
                                    Weak Signal
                                  </div>
                                );
                              }
                              
                              if (device.connectionStatus === "unstable") {
                                return (
                                  <div className="inline-flex items-center justify-center px-3 py-1.5 rounded-md border text-xs font-normal bg-[rgba(255,165,0,0.14)] border-[#ffa500] text-[#cc8400]">
                                    Unstable
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
                            <div className="flex items-center justify-center gap-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(device)}
                                data-testid={`button-edit-device-${device.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openCredentials(device)}
                                data-testid={`button-credentials-device-${device.id}`}
                                title="Manage PowerMon URL"
                              >
                                <Key className="h-4 w-4 text-purple-600" />
                              </Button>
                              {device.truckId ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleUnassign(device)}
                                  data-testid={`button-unassign-device-${device.id}`}
                                >
                                  <Unlink className="h-4 w-4 text-orange-600" />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setAssigningDevice(device)}
                                  disabled={allTrucks.filter(t => t.organizationId === device.organizationId && !devices.some(d => d.truckId === t.id)).length === 0}
                                  data-testid={`button-assign-device-${device.id}`}
                                >
                                  <Link2 className="h-4 w-4 text-blue-600" />
                                </Button>
                              )}
                              {(device.connectionStatus === "unstable" || device.connectionStatus === "offline" || device.connectionStatus === "no_power" || device.connectionStatus === "probing") ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleResetStatus(device)}
                                  disabled={resetDeviceStatus.isPending}
                                  data-testid={`button-reset-device-${device.id}`}
                                  title="Set Online (reset connection status)"
                                >
                                  <RotateCcw className="h-4 w-4 text-green-600" />
                                </Button>
                              ) : (device.connectionStatus !== "disconnected") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleSetOffline(device)}
                                  disabled={setDeviceOffline.isPending}
                                  data-testid={`button-offline-device-${device.id}`}
                                  title="Set Offline (stop polling)"
                                >
                                  <WifiOff className="h-4 w-4 text-orange-600" />
                                </Button>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {/* span wrapper so the tooltip still fires
                                      hover/focus when the button is disabled */}
                                  <span className="inline-flex">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => setHistoryExportDevice(device)}
                                      disabled={!device.truckId}
                                      aria-label={
                                        device.truckId
                                          ? "Export truck history"
                                          : "Assign a truck to enable history export"
                                      }
                                      data-testid={`button-export-history-device-${device.id}`}
                                    >
                                      <Download className="h-4 w-4 text-blue-600" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {device.truckId
                                    ? "Export truck history"
                                    : "Assign a truck to enable history export"}
                                </TooltipContent>
                              </Tooltip>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeletingDevice(device)}
                                data-testid={`button-delete-device-${device.id}`}
                                title="Delete device"
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
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

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Register Device</DialogTitle>
              <DialogDescription>
                Add a new PowerMon device. Serial number, firmware version, and hardware revision will be auto-populated when the device connects.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="deviceName">Device Name (optional)</Label>
                <Input
                  id="deviceName"
                  value={formData.deviceName}
                  onChange={(e) => setFormData({ ...formData, deviceName: e.target.value })}
                  placeholder="PowerMon Unit 1"
                  data-testid="input-device-name"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="batteryVoltage">Battery Voltage (V)</Label>
                  <Input
                    id="batteryVoltage"
                    type="number"
                    step="0.1"
                    value={formData.batteryVoltage}
                    onChange={(e) => setFormData({ ...formData, batteryVoltage: e.target.value })}
                    placeholder="12.8"
                    data-testid="input-battery-voltage"
                  />
                </div>
                <div>
                  <Label htmlFor="batteryAh">Battery Ah</Label>
                  <Input
                    id="batteryAh"
                    type="number"
                    step="0.1"
                    value={formData.batteryAh}
                    onChange={(e) => setFormData({ ...formData, batteryAh: e.target.value })}
                    placeholder="100"
                    data-testid="input-battery-ah"
                  />
                </div>
                <div>
                  <Label htmlFor="numberOfBatteries"># of Batteries</Label>
                  <Input
                    id="numberOfBatteries"
                    type="number"
                    step="1"
                    min="1"
                    value={formData.numberOfBatteries}
                    onChange={(e) => setFormData({ ...formData, numberOfBatteries: e.target.value })}
                    placeholder="4"
                    data-testid="input-num-batteries"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Device</DialogTitle>
              <DialogDescription>
                Update device details.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
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
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="edit-batteryVoltage">Battery Voltage (V)</Label>
                  <Input
                    id="edit-batteryVoltage"
                    type="number"
                    step="0.1"
                    value={formData.batteryVoltage}
                    onChange={(e) => setFormData({ ...formData, batteryVoltage: e.target.value })}
                    placeholder="12.8"
                    data-testid="input-edit-battery-voltage"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-batteryAh">Battery Ah</Label>
                  <Input
                    id="edit-batteryAh"
                    type="number"
                    step="0.1"
                    value={formData.batteryAh}
                    onChange={(e) => setFormData({ ...formData, batteryAh: e.target.value })}
                    placeholder="100"
                    data-testid="input-edit-battery-ah"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-numberOfBatteries"># of Batteries</Label>
                  <Input
                    id="edit-numberOfBatteries"
                    type="number"
                    step="1"
                    min="1"
                    value={formData.numberOfBatteries}
                    onChange={(e) => setFormData({ ...formData, numberOfBatteries: e.target.value })}
                    placeholder="4"
                    data-testid="input-edit-num-batteries"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
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

        <AdminExportDialog
          open={isExportOpen}
          onOpenChange={setIsExportOpen}
          organizationId={selectedOrgId ?? null}
          organizationName={
            selectedOrgId
              ? organizations.find((o) => o.id === selectedOrgId)?.name ?? null
              : null
          }
          searchQuery={searchQuery}
        />

        {historyExportDevice && historyExportDevice.truckId && (
          <AdminTruckHistoryExportDialog
            open={!!historyExportDevice}
            onOpenChange={(open) => {
              if (!open) setHistoryExportDevice(null);
            }}
            truckId={historyExportDevice.truckId}
            truckNumber={
              allTrucks.find((t) => t.id === historyExportDevice.truckId)?.truckNumber ??
              `Truck #${historyExportDevice.truckId}`
            }
            organizationId={historyExportDevice.organizationId}
            organizationName={
              organizations.find((o) => o.id === historyExportDevice.organizationId)?.name ?? null
            }
          />
        )}
      </div>
    </AdminLayout>
  );
}
