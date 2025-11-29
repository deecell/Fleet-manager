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
  useCreateFleet,
  useUpdateFleet,
  useDeleteFleet,
} from "@/lib/admin-api";
import { Plus, Pencil, Trash2, Layers } from "lucide-react";
import type { Fleet } from "@shared/schema";

export default function FleetsPage() {
  const { toast } = useToast();
  const { data: orgsData } = useAdminOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState<number | undefined>();
  const { data: fleetsData, isLoading } = useAdminFleets(selectedOrgId);
  const createFleet = useCreateFleet();
  const updateFleet = useUpdateFleet();
  const deleteFleet = useDeleteFleet();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingFleet, setEditingFleet] = useState<Fleet | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Fleet | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    timezone: "America/Los_Angeles",
    isActive: true,
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", timezone: "America/Los_Angeles", isActive: true });
  };

  const handleCreate = async () => {
    if (!selectedOrgId) return;
    try {
      await createFleet.mutateAsync({ orgId: selectedOrgId, data: formData });
      toast({ title: "Fleet created successfully" });
      setIsCreateOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Failed to create fleet", variant: "destructive" });
    }
  };

  const handleUpdate = async () => {
    if (!editingFleet || !selectedOrgId) return;
    try {
      await updateFleet.mutateAsync({ id: editingFleet.id, orgId: selectedOrgId, data: formData });
      toast({ title: "Fleet updated successfully" });
      setEditingFleet(null);
      resetForm();
    } catch (error) {
      toast({ title: "Failed to update fleet", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm || !selectedOrgId) return;
    try {
      await deleteFleet.mutateAsync({ id: deleteConfirm.id, orgId: selectedOrgId });
      toast({ title: "Fleet deleted successfully" });
      setDeleteConfirm(null);
    } catch (error) {
      toast({ title: "Failed to delete fleet", variant: "destructive" });
    }
  };

  const openEdit = (fleet: Fleet) => {
    setFormData({
      name: fleet.name,
      description: fleet.description || "",
      timezone: fleet.timezone || "America/Los_Angeles",
      isActive: fleet.isActive ?? true,
    });
    setEditingFleet(fleet);
  };

  const organizations = orgsData?.organizations || [];
  const fleets = fleetsData?.fleets || [];

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              Fleets
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage fleet groups within organizations
            </p>
          </div>
          <Button 
            onClick={() => setIsCreateOpen(true)} 
            disabled={!selectedOrgId}
            data-testid="button-create-fleet"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Fleet
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Label htmlFor="org-select" className="whitespace-nowrap">Organization:</Label>
              <Select 
                value={selectedOrgId?.toString()} 
                onValueChange={(v) => setSelectedOrgId(parseInt(v))}
              >
                <SelectTrigger className="w-64" data-testid="select-organization">
                  <SelectValue placeholder="Select an organization" />
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
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {!selectedOrgId ? (
              <div className="p-8 text-center text-muted-foreground">
                Select an organization to view its fleets
              </div>
            ) : isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : fleets.length === 0 ? (
              <div className="p-8 text-center">
                <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No fleets in this organization</p>
                <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
                  Create your first fleet
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Timezone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fleets.map((fleet) => (
                    <TableRow key={fleet.id} data-testid={`row-fleet-${fleet.id}`}>
                      <TableCell className="font-medium">{fleet.name}</TableCell>
                      <TableCell className="text-muted-foreground">{fleet.description || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{fleet.timezone}</TableCell>
                      <TableCell>
                        <Badge variant={fleet.isActive ? "default" : "secondary"}>
                          {fleet.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {fleet.createdAt ? new Date(fleet.createdAt).toLocaleDateString() : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(fleet)}
                          data-testid={`button-edit-fleet-${fleet.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm(fleet)}
                          data-testid={`button-delete-fleet-${fleet.id}`}
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Fleet</DialogTitle>
              <DialogDescription>
                Add a new fleet to the selected organization.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Fleet Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Flatbed Fleet"
                  data-testid="input-fleet-name"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Long-haul flatbed trucks"
                  data-testid="input-fleet-description"
                />
              </div>
              <div>
                <Label htmlFor="timezone">Timezone</Label>
                <Select value={formData.timezone} onValueChange={(v) => setFormData({ ...formData, timezone: v })}>
                  <SelectTrigger data-testid="select-fleet-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                    <SelectItem value="America/Denver">Mountain Time</SelectItem>
                    <SelectItem value="America/Chicago">Central Time</SelectItem>
                    <SelectItem value="America/New_York">Eastern Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createFleet.isPending} data-testid="button-submit-create">
                {createFleet.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editingFleet} onOpenChange={() => setEditingFleet(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Fleet</DialogTitle>
              <DialogDescription>
                Update fleet details.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-name">Fleet Name</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  data-testid="input-edit-fleet-name"
                />
              </div>
              <div>
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  data-testid="input-edit-fleet-description"
                />
              </div>
              <div>
                <Label htmlFor="edit-timezone">Timezone</Label>
                <Select value={formData.timezone} onValueChange={(v) => setFormData({ ...formData, timezone: v })}>
                  <SelectTrigger data-testid="select-edit-fleet-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                    <SelectItem value="America/Denver">Mountain Time</SelectItem>
                    <SelectItem value="America/Chicago">Central Time</SelectItem>
                    <SelectItem value="America/New_York">Eastern Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-status">Status</Label>
                <Select 
                  value={formData.isActive ? "active" : "inactive"} 
                  onValueChange={(v) => setFormData({ ...formData, isActive: v === "active" })}
                >
                  <SelectTrigger data-testid="select-edit-fleet-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingFleet(null)}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={updateFleet.isPending} data-testid="button-submit-update">
                {updateFleet.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Fleet</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteConfirm?.name}"? This will remove all associated trucks.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteFleet.isPending} data-testid="button-confirm-delete">
                {deleteFleet.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
