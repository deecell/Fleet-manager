import { useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  useCreateOrganization,
  useUpdateOrganization,
  useDeleteOrganization,
} from "@/lib/admin-api";
import { Plus, Pencil, Trash2, Building2 } from "lucide-react";
import type { Organization } from "@shared/schema";

export default function OrganizationsPage() {
  const { toast } = useToast();
  const { data, isLoading } = useAdminOrganizations();
  const createOrg = useCreateOrganization();
  const updateOrg = useUpdateOrganization();
  const deleteOrg = useDeleteOrganization();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Organization | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    isActive: true,
  });

  const resetForm = () => {
    setFormData({ name: "", slug: "", isActive: true });
  };

  const handleCreate = async () => {
    try {
      await createOrg.mutateAsync(formData);
      toast({ title: "Organization created successfully" });
      setIsCreateOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Failed to create organization", variant: "destructive" });
    }
  };

  const handleUpdate = async () => {
    if (!editingOrg) return;
    try {
      await updateOrg.mutateAsync({ id: editingOrg.id, data: formData });
      toast({ title: "Organization updated successfully" });
      setEditingOrg(null);
      resetForm();
    } catch (error) {
      toast({ title: "Failed to update organization", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteOrg.mutateAsync(deleteConfirm.id);
      toast({ title: "Organization deleted successfully" });
      setDeleteConfirm(null);
    } catch (error) {
      toast({ title: "Failed to delete organization", variant: "destructive" });
    }
  };

  const openEdit = (org: Organization) => {
    setFormData({
      name: org.name,
      slug: org.slug,
      isActive: org.isActive ?? true,
    });
    setEditingOrg(org);
  };

  const organizations = data?.organizations || [];

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              Organizations
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage customer accounts and their settings
            </p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-org">
            <Plus className="h-4 w-4 mr-2" />
            Add Organization
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : organizations.length === 0 ? (
              <div className="p-8 text-center">
                <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No organizations yet</p>
                <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
                  Create your first organization
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizations.map((org) => (
                    <TableRow key={org.id} data-testid={`row-org-${org.id}`}>
                      <TableCell className="font-medium">{org.name}</TableCell>
                      <TableCell className="text-muted-foreground">{org.slug}</TableCell>
                      <TableCell>
                        {org.isActive ? (
                          <Badge 
                            className="rounded-md font-medium"
                            style={{ backgroundColor: 'rgba(0, 201, 80, 0.14)', color: '#00953b' }}
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge 
                            variant="secondary"
                            className="bg-[#dedede] text-[#636363] rounded-md"
                          >
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {org.createdAt ? new Date(org.createdAt).toLocaleDateString() : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(org)}
                          data-testid={`button-edit-org-${org.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm(org)}
                          data-testid={`button-delete-org-${org.id}`}
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
              <DialogTitle>Create Organization</DialogTitle>
              <DialogDescription>
                Add a new customer organization to the system.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Organization Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Acme Trucking Co."
                  data-testid="input-org-name"
                />
              </div>
              <div>
                <Label htmlFor="slug">Slug (URL-friendly identifier)</Label>
                <Input
                  id="slug"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s/g, '-') })}
                  placeholder="acme-trucking"
                  data-testid="input-org-slug"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createOrg.isPending} data-testid="button-submit-create">
                {createOrg.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editingOrg} onOpenChange={() => setEditingOrg(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Organization</DialogTitle>
              <DialogDescription>
                Update organization details.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-name">Organization Name</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  data-testid="input-edit-org-name"
                />
              </div>
              <div>
                <Label htmlFor="edit-slug">Slug</Label>
                <Input
                  id="edit-slug"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s/g, '-') })}
                  data-testid="input-edit-org-slug"
                />
              </div>
              <div>
                <Label htmlFor="edit-status">Status</Label>
                <Select 
                  value={formData.isActive ? "active" : "inactive"} 
                  onValueChange={(v) => setFormData({ ...formData, isActive: v === "active" })}
                >
                  <SelectTrigger data-testid="select-edit-org-status">
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
              <Button variant="outline" onClick={() => setEditingOrg(null)}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={updateOrg.isPending} data-testid="button-submit-update">
                {updateOrg.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Organization</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteConfirm?.name}"? This action cannot be undone and will remove all associated fleets, trucks, and devices.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteOrg.isPending} data-testid="button-confirm-delete">
                {deleteOrg.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
