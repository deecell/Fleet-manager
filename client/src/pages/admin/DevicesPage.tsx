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
  useDeviceCredential,
  useCreateDeviceCredential,
  useUpdateDeviceCredential,
} from "@/lib/admin-api";
import { Plus, Pencil, Cpu, Link2, Unlink, Key, ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import type { PowerMonDevice } from "@shared/schema";

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

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<PowerMonDevice | null>(null);
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
      serialNumber: device.serialNumber,
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
          <Button 
            onClick={() => setIsCreateOpen(true)} 
            disabled={!selectedOrgId}
            data-testid="button-create-device"
          >
            <Plus className="h-4 w-4 mr-2" />
            Register Device
          </Button>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serial Number</TableHead>
                    <TableHead 
                      className="cursor-pointer select-none hover:bg-muted/50"
                      onClick={() => handleSort("deviceName")}
                      data-testid="sort-device-name"
                    >
                      <div className="flex items-center gap-1">
                        Device Name
                        {sortField === "deviceName" ? (
                          sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer select-none hover:bg-muted/50 text-center"
                      onClick={() => handleSort("firmwareVersion")}
                      data-testid="sort-firmware"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Firmware
                        {sortField === "firmwareVersion" ? (
                          sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer select-none hover:bg-muted/50"
                      onClick={() => handleSort("connectionStatus")}
                      data-testid="sort-connection"
                    >
                      <div className="flex items-center gap-1">
                        Connection
                        {sortField === "connectionStatus" ? (
                          sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                    </TableHead>
                    <TableHead>Data Status</TableHead>
                    <TableHead 
                      className="cursor-pointer select-none hover:bg-muted/50 text-center"
                      onClick={() => handleSort("assignedTruck")}
                      data-testid="sort-assigned-truck"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Assigned Truck
                        {sortField === "assignedTruck" ? (
                          sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer select-none hover:bg-muted/50"
                      onClick={() => handleSort("lastSeenAt")}
                      data-testid="sort-last-seen"
                    >
                      <div className="flex items-center gap-1">
                        Last Seen
                        {sortField === "lastSeenAt" ? (
                          sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer select-none hover:bg-muted/50"
                      onClick={() => handleSort("lastReportedAt")}
                      data-testid="sort-last-reported"
                    >
                      <div className="flex items-center gap-1">
                        Last Reported
                        {sortField === "lastReportedAt" ? (
                          sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                    </TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((device) => (
                    <TableRow key={device.id} data-testid={`row-device-${device.id}`}>
                      <TableCell className="font-mono text-sm">{device.serialNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{device.deviceName || "-"}</TableCell>
                      <TableCell className="text-muted-foreground text-center">{device.firmwareVersion || "-"}</TableCell>
                      <TableCell>
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${
                          device.connectionStatus === "online" 
                            ? "bg-[rgba(0,201,80,0.14)] border-[#00c950] text-[#00953b]" 
                            : device.connectionStatus === "unstable"
                            ? "bg-[rgba(255,165,0,0.14)] border-[#ffa500] text-[#cc8400]"
                            : "bg-[rgba(255,9,0,0.14)] border-[#ff0900] text-[#ff0900]"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            device.connectionStatus === "online" ? "bg-[#00c950]" 
                              : device.connectionStatus === "unstable" ? "bg-[#ffa500]"
                              : "bg-[#ff0900]"
                          }`} />
                          {device.connectionStatus === "online" ? "Online" 
                            : device.connectionStatus === "unstable" ? "Unstable"
                            : "Offline"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${
                          device.dataStatus === "reporting" 
                            ? "bg-[rgba(0,201,80,0.14)] border-[#00c950] text-[#00953b]" 
                            : device.dataStatus === "stale"
                            ? "bg-[rgba(255,165,0,0.14)] border-[#ffa500] text-[#cc8400]"
                            : "bg-[rgba(128,128,128,0.14)] border-[#808080] text-[#666666]"
                        }`}>
                          {device.dataStatus === "reporting" ? "Reporting" 
                            : device.dataStatus === "stale" ? "Stale"
                            : "No Data"}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {device.truckId ? (
                          <Badge variant="outline">
                            {trucks.find(t => t.id === device.truckId)?.truckNumber || `Truck #${device.truckId}`}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {device.lastReportedAt ? new Date(device.lastReportedAt).toLocaleString() : "-"}
                      </TableCell>
                      <TableCell className="text-center">
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
                <Label htmlFor="serialNumber">Serial Number</Label>
                <Input
                  id="serialNumber"
                  value={formData.serialNumber}
                  onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                  placeholder="PM-0001-ABCD"
                  data-testid="input-serial-number"
                />
              </div>
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
              <Button onClick={handleCreate} disabled={createDevice.isPending || !formData.serialNumber} data-testid="button-submit-create">
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
                  value={formData.serialNumber}
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
                Link device "{assigningDevice?.serialNumber}" to a truck.
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
                    <div className="bg-muted p-3 rounded-md">
                      <Label className="text-xs text-muted-foreground">Current URL</Label>
                      <p className="font-mono text-sm break-all mt-1">
                        {credentialData.credential.applinkUrl || "Not set"}
                      </p>
                      <div className="flex gap-4 mt-2 text-xs">
                        <span className={credentialData.credential.isActive ? "text-green-700" : "text-[#636363]"}>
                          Status: {credentialData.credential.isActive ? "Active" : "Inactive"}
                        </span>
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
      </div>
    </AdminLayout>
  );
}
