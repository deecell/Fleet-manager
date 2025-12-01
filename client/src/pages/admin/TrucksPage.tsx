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
  useAdminFleets,
  useAdminTrucks,
  useCreateTruck,
  useUpdateTruck,
  useDeleteTruck,
} from "@/lib/admin-api";
import { Plus, Pencil, Trash2, Truck } from "lucide-react";
import type { Truck as TruckType } from "@shared/schema";

export default function TrucksPage() {
  const { toast } = useToast();
  const { data: orgsData } = useAdminOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState<number | undefined>();
  const [selectedFleetId, setSelectedFleetId] = useState<number | undefined>();
  const { data: fleetsData } = useAdminFleets(selectedOrgId);
  const { data: trucksData, isLoading } = useAdminTrucks(selectedOrgId, selectedFleetId);
  const createTruck = useCreateTruck();
  const updateTruck = useUpdateTruck();
  const deleteTruck = useDeleteTruck();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTruck, setEditingTruck] = useState<TruckType | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TruckType | null>(null);

  const [formData, setFormData] = useState({
    fleetId: 0,
    truckNumber: "",
    driverName: "",
    make: "",
    model: "",
    year: new Date().getFullYear(),
    vinNumber: "",
    licensePlate: "",
    status: "in-service",
    isActive: true,
  });

  const resetForm = () => {
    setFormData({
      fleetId: fleetsData?.fleets?.[0]?.id || 0,
      truckNumber: "",
      driverName: "",
      make: "",
      model: "",
      year: new Date().getFullYear(),
      vinNumber: "",
      licensePlate: "",
      status: "in-service",
      isActive: true,
    });
  };

  const handleCreate = async () => {
    if (!selectedOrgId || !formData.fleetId) return;
    try {
      await createTruck.mutateAsync({ orgId: selectedOrgId, data: formData });
      toast({ title: "Truck created successfully" });
      setIsCreateOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Failed to create truck", variant: "destructive" });
    }
  };

  const handleUpdate = async () => {
    if (!editingTruck || !selectedOrgId) return;
    try {
      await updateTruck.mutateAsync({ id: editingTruck.id, orgId: selectedOrgId, data: formData });
      toast({ title: "Truck updated successfully" });
      setEditingTruck(null);
      resetForm();
    } catch (error) {
      toast({ title: "Failed to update truck", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm || !selectedOrgId) return;
    try {
      await deleteTruck.mutateAsync({ id: deleteConfirm.id, orgId: selectedOrgId });
      toast({ title: "Truck deleted successfully" });
      setDeleteConfirm(null);
    } catch (error) {
      toast({ title: "Failed to delete truck", variant: "destructive" });
    }
  };

  const openEdit = (truck: TruckType) => {
    setFormData({
      fleetId: truck.fleetId,
      truckNumber: truck.truckNumber,
      driverName: truck.driverName || "",
      make: truck.make || "",
      model: truck.model || "",
      year: truck.year || new Date().getFullYear(),
      vinNumber: truck.vinNumber || "",
      licensePlate: truck.licensePlate || "",
      status: truck.status || "in-service",
      isActive: truck.isActive ?? true,
    });
    setEditingTruck(truck);
  };

  const openCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const organizations = orgsData?.organizations || [];
  const fleets = fleetsData?.fleets || [];
  const trucks = trucksData?.trucks || [];

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              Trucks
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage trucks within fleets
            </p>
          </div>
          <Button 
            onClick={openCreate} 
            disabled={!selectedOrgId || fleets.length === 0}
            data-testid="button-create-truck"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Truck
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Label htmlFor="org-select" className="whitespace-nowrap">Organization:</Label>
                <Select 
                  value={selectedOrgId?.toString()} 
                  onValueChange={(v) => {
                    setSelectedOrgId(parseInt(v));
                    setSelectedFleetId(undefined);
                  }}
                >
                  <SelectTrigger className="w-48" data-testid="select-organization">
                    <SelectValue placeholder="Select org" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id.toString()}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="fleet-select" className="whitespace-nowrap">Fleet:</Label>
                <Select 
                  value={selectedFleetId?.toString() || "all"} 
                  onValueChange={(v) => setSelectedFleetId(v === "all" ? undefined : parseInt(v))}
                  disabled={!selectedOrgId}
                >
                  <SelectTrigger className="w-48" data-testid="select-fleet">
                    <SelectValue placeholder="All fleets" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All fleets</SelectItem>
                    {fleets.map((fleet) => (
                      <SelectItem key={fleet.id} value={fleet.id.toString()}>
                        {fleet.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {!selectedOrgId ? (
              <div className="p-8 text-center text-muted-foreground">
                Select an organization to view trucks
              </div>
            ) : isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : trucks.length === 0 ? (
              <div className="p-8 text-center">
                <Truck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No trucks found</p>
                {fleets.length > 0 && (
                  <Button className="mt-4" onClick={openCreate}>
                    Add your first truck
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Truck #</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Make/Model</TableHead>
                    <TableHead>VIN</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trucks.map((truck) => (
                    <TableRow key={truck.id} data-testid={`row-truck-${truck.id}`}>
                      <TableCell className="font-medium">{truck.truckNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{truck.driverName || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {[truck.make, truck.model, truck.year].filter(Boolean).join(" ") || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {truck.vinNumber || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={truck.status === "in-service" ? "default" : "secondary"}>
                          {truck.status === "in-service" ? "In Service" : "Not In Service"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(truck)}
                          data-testid={`button-edit-truck-${truck.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm(truck)}
                          data-testid={`button-delete-truck-${truck.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Truck</DialogTitle>
              <DialogDescription>
                Add a new truck to the selected organization.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              <div>
                <Label htmlFor="fleet">Fleet</Label>
                <Select value={formData.fleetId?.toString() || ""} onValueChange={(v) => setFormData({ ...formData, fleetId: parseInt(v) })}>
                  <SelectTrigger data-testid="select-truck-fleet">
                    <SelectValue placeholder="Select fleet" />
                  </SelectTrigger>
                  <SelectContent>
                    {fleets.map((fleet) => (
                      <SelectItem key={fleet.id} value={fleet.id.toString()}>
                        {fleet.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="truckNumber">Truck Number</Label>
                  <Input
                    id="truckNumber"
                    value={formData.truckNumber}
                    onChange={(e) => setFormData({ ...formData, truckNumber: e.target.value })}
                    placeholder="TRK-001"
                    data-testid="input-truck-number"
                  />
                </div>
                <div>
                  <Label htmlFor="driverName">Driver Name</Label>
                  <Input
                    id="driverName"
                    value={formData.driverName}
                    onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                    placeholder="John Smith"
                    data-testid="input-driver-name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="make">Make</Label>
                  <Input
                    id="make"
                    value={formData.make}
                    onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                    placeholder="Freightliner"
                    data-testid="input-make"
                  />
                </div>
                <div>
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    placeholder="Cascadia"
                    data-testid="input-model"
                  />
                </div>
                <div>
                  <Label htmlFor="year">Year</Label>
                  <Input
                    id="year"
                    type="number"
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || 0 })}
                    data-testid="input-year"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="vinNumber">VIN Number</Label>
                  <Input
                    id="vinNumber"
                    value={formData.vinNumber}
                    onChange={(e) => setFormData({ ...formData, vinNumber: e.target.value })}
                    placeholder="1FUJGLD..."
                    data-testid="input-vin"
                  />
                </div>
                <div>
                  <Label htmlFor="licensePlate">License Plate</Label>
                  <Input
                    id="licensePlate"
                    value={formData.licensePlate}
                    onChange={(e) => setFormData({ ...formData, licensePlate: e.target.value })}
                    placeholder="ABC-1234"
                    data-testid="input-license"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                  <SelectTrigger data-testid="select-truck-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in-service">In Service</SelectItem>
                    <SelectItem value="not-in-service">Not In Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createTruck.isPending || !formData.fleetId} data-testid="button-submit-create">
                {createTruck.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editingTruck} onOpenChange={() => setEditingTruck(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Truck</DialogTitle>
              <DialogDescription>
                Update truck details.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-truckNumber">Truck Number</Label>
                  <Input
                    id="edit-truckNumber"
                    value={formData.truckNumber}
                    onChange={(e) => setFormData({ ...formData, truckNumber: e.target.value })}
                    data-testid="input-edit-truck-number"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-driverName">Driver Name</Label>
                  <Input
                    id="edit-driverName"
                    value={formData.driverName}
                    onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                    data-testid="input-edit-driver-name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="edit-make">Make</Label>
                  <Input
                    id="edit-make"
                    value={formData.make}
                    onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                    data-testid="input-edit-make"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-model">Model</Label>
                  <Input
                    id="edit-model"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    data-testid="input-edit-model"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-year">Year</Label>
                  <Input
                    id="edit-year"
                    type="number"
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || 0 })}
                    data-testid="input-edit-year"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="edit-status">Status</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                  <SelectTrigger data-testid="select-edit-truck-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in-service">In Service</SelectItem>
                    <SelectItem value="not-in-service">Not In Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingTruck(null)}>
                Cancel
              </Button>
              <Button 
                onClick={handleUpdate} 
                disabled={updateTruck.isPending} 
                data-testid="button-submit-update"
                style={{ backgroundColor: '#303030' }}
              >
                {updateTruck.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Truck</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete truck "{deleteConfirm?.truckNumber}"?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteTruck.isPending} data-testid="button-confirm-delete">
                {deleteTruck.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
