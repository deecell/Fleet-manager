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
  useAdminUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
} from "@/lib/admin-api";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import type { User } from "@shared/schema";

export default function UsersPage() {
  const { toast } = useToast();
  const { data: orgsData } = useAdminOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState<number | undefined>();
  const { data: usersData, isLoading } = useAdminUsers(selectedOrgId);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<User | null>(null);
  const [createOrgId, setCreateOrgId] = useState<number | undefined>();

  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "user",
    isActive: true,
    password: "",
  });

  const resetForm = () => {
    setFormData({
      email: "",
      firstName: "",
      lastName: "",
      role: "user",
      isActive: true,
      password: "",
    });
  };

  const handleCreate = async () => {
    const orgId = createOrgId || selectedOrgId;
    if (!orgId) return;
    try {
      await createUser.mutateAsync({ orgId, data: formData });
      toast({ title: "User created successfully" });
      setIsCreateOpen(false);
      resetForm();
      setCreateOrgId(undefined);
    } catch (error) {
      toast({ title: "Failed to create user", variant: "destructive" });
    }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    try {
      await updateUser.mutateAsync({ id: editingUser.id, orgId: editingUser.organizationId, data: formData });
      toast({ title: "User updated successfully" });
      setEditingUser(null);
      resetForm();
    } catch (error) {
      toast({ title: "Failed to update user", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteUser.mutateAsync({ id: deleteConfirm.id, orgId: deleteConfirm.organizationId });
      toast({ title: "User deleted successfully" });
      setDeleteConfirm(null);
    } catch (error) {
      toast({ title: "Failed to delete user", variant: "destructive" });
    }
  };

  const openEdit = (user: User) => {
    setFormData({
      email: user.email,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      role: user.role || "user",
      isActive: user.isActive ?? true,
      password: "",
    });
    setEditingUser(user);
  };

  const openCreate = () => {
    resetForm();
    setCreateOrgId(selectedOrgId);
    setIsCreateOpen(true);
  };

  const organizations = orgsData?.organizations || [];
  const users = usersData?.users || [];

  const getRoleBadgeVariant = (role: string | null) => {
    switch (role) {
      case "super_admin":
        return "secondary";
      case "org_admin":
        return "default";
      case "manager":
        return "secondary";
      default:
        return "outline";
    }
  };

  const formatRole = (role: string | null) => {
    switch (role) {
      case "super_admin":
        return "Super Admin";
      case "org_admin":
        return "Org Admin";
      case "manager":
        return "Manager";
      case "viewer":
        return "Viewer";
      default:
        return "User";
    }
  };

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              Users
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage user accounts and roles
            </p>
          </div>
          <Button 
            onClick={openCreate} 
            disabled={organizations.length === 0}
            data-testid="button-create-user"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
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
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No users found</p>
                {organizations.length > 0 && (
                  <Button className="mt-4" onClick={openCreate}>
                    Add your first user
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium">{user.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {[user.firstName, user.lastName].filter(Boolean).join(" ") || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="secondary"
                          className="bg-[#dedede] text-[#636363]"
                        >
                          {formatRole(user.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="secondary"
                          className={user.isActive ? "bg-green-100 text-green-700" : "bg-[#dedede] text-[#636363]"}
                        >
                          {user.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(user)}
                          data-testid={`button-edit-user-${user.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm(user)}
                          data-testid={`button-delete-user-${user.id}`}
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
              <DialogTitle>Add User</DialogTitle>
              <DialogDescription>
                Create a new user account.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="create-org">Organization</Label>
                <Select value={createOrgId?.toString()} onValueChange={(v) => setCreateOrgId(parseInt(v))}>
                  <SelectTrigger data-testid="select-user-organization">
                    <SelectValue placeholder="Select organization" />
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
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="user@example.com"
                  data-testid="input-email"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    placeholder="John"
                    data-testid="input-first-name"
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    placeholder="Doe"
                    data-testid="input-last-name"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="role">Role</Label>
                <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
                  <SelectTrigger data-testid="select-user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="org_admin">Org Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Minimum 6 characters"
                  data-testid="input-password"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Required for customer login access
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreate} 
                disabled={createUser.isPending || !createOrgId || !formData.email || formData.password.length < 6} 
                data-testid="button-submit-create"
              >
                {createUser.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>
                Update user details and role.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  data-testid="input-edit-email"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-firstName">First Name</Label>
                  <Input
                    id="edit-firstName"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    data-testid="input-edit-first-name"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-lastName">Last Name</Label>
                  <Input
                    id="edit-lastName"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    data-testid="input-edit-last-name"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="edit-role">Role</Label>
                <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
                  <SelectTrigger data-testid="select-edit-user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="org_admin">Org Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-status">Status</Label>
                <Select 
                  value={formData.isActive ? "active" : "inactive"} 
                  onValueChange={(v) => setFormData({ ...formData, isActive: v === "active" })}
                >
                  <SelectTrigger data-testid="select-edit-user-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-password">New Password (optional)</Label>
                <Input
                  id="edit-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Leave empty to keep current password"
                  data-testid="input-edit-password"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Minimum 6 characters if changing
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingUser(null)}>
                Cancel
              </Button>
              <Button 
                onClick={handleUpdate} 
                disabled={updateUser.isPending || (formData.password.length > 0 && formData.password.length < 6)} 
                data-testid="button-submit-update"
              >
                {updateUser.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete User</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteConfirm?.email}"? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteUser.isPending} data-testid="button-confirm-delete">
                {deleteUser.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
