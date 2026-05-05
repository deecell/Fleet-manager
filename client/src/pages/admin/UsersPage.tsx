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
  useAdminTrucks,
  useAllAdminTrucks,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useAssignTruckToUser,
  useAdminSession,
  usePlatformAdmins,
  useInvitePlatformAdmin,
  useRevokePlatformAdmin,
  useResendUserInvitation,
  useResendPlatformAdminInvitation,
  type PlatformAdminDto,
} from "@/lib/admin-api";
import { Plus, Pencil, Trash2, Users, Mail, Truck, ShieldCheck, Send } from "lucide-react";
import type { User, Truck as TruckType } from "@shared/schema";

export default function UsersPage() {
  const { toast } = useToast();
  const { data: orgsData } = useAdminOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState<number | undefined>();
  const { data: usersData, isLoading } = useAdminUsers(selectedOrgId);
  const { data: trucksData } = useAdminTrucks(selectedOrgId);
  const { data: allTrucksData } = useAllAdminTrucks();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const assignTruck = useAssignTruckToUser();
  const resendInvitation = useResendUserInvitation(selectedOrgId);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<User | null>(null);
  const [createOrgId, setCreateOrgId] = useState<number | undefined>();
  const [assigningUser, setAssigningUser] = useState<User | null>(null);
  const [selectedTruckId, setSelectedTruckId] = useState<string>("none");

  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "operator",
    isActive: true,
    password: "",
  });

  // Use org-specific trucks when an org is selected, otherwise use all trucks
  const trucks = selectedOrgId 
    ? (trucksData?.trucks || [])
    : (allTrucksData?.trucks || []);

  const resetForm = () => {
    setFormData({
      email: "",
      firstName: "",
      lastName: "",
      role: "operator",
      isActive: true,
      password: "",
    });
  };

  const handleCreate = async () => {
    const orgId = createOrgId || selectedOrgId;
    if (!orgId) return;
    try {
      const { password, ...userData } = formData;
      const result = await createUser.mutateAsync({ orgId, data: userData });
      
      if (result.invitationEmailSent) {
        toast({ 
          title: "User created successfully",
          description: "Invitation email sent to " + formData.email,
        });
      } else {
        toast({ 
          title: "User created",
          description: "Invitation email could not be sent. Check email configuration.",
          variant: "destructive",
        });
      }
      
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

  const handleAssignTruck = async () => {
    if (!assigningUser) return;
    try {
      const truckId = selectedTruckId === "none" ? null : parseInt(selectedTruckId, 10);
      await assignTruck.mutateAsync({ 
        userId: assigningUser.id, 
        orgId: assigningUser.organizationId,
        truckId 
      });
      toast({ title: truckId ? "Truck assigned successfully" : "Truck unassigned successfully" });
      setAssigningUser(null);
      setSelectedTruckId("none");
    } catch (error) {
      toast({ title: "Failed to assign truck", variant: "destructive" });
    }
  };

  const openAssignTruck = (user: User) => {
    setAssigningUser(user);
    setSelectedTruckId(user.assignedTruckId?.toString() || "none");
  };

  const getTruckDisplay = (truckId: number | null | undefined) => {
    if (!truckId) return null;
    const truck = trucks.find(t => t.id === truckId);
    return truck ? truck.truckNumber : `#${truckId}`;
  };

  const openEdit = (user: User) => {
    setFormData({
      email: user.email,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      role: user.role || "operator",
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
      case "fleet_manager":
        return "default";
      case "operator":
        return "outline";
      default:
        return "outline";
    }
  };

  const formatRole = (role: string | null) => {
    switch (role) {
      case "super_admin":
        return "Super Admin";
      case "fleet_manager":
        return "Fleet Manager";
      case "operator":
        return "Operator";
      default:
        return role || "User";
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

        <PlatformAdminsCard />

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
                    {!selectedOrgId && <TableHead>Organization</TableHead>}
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned Truck</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium">{user.email}</TableCell>
                      {!selectedOrgId && (
                        <TableCell className="text-muted-foreground">
                          {organizations.find(o => o.id === user.organizationId)?.name || "-"}
                        </TableCell>
                      )}
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
                        {user.isActive ? (
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
                      <TableCell>
                        {getTruckDisplay(user.assignedTruckId) ? (
                          <Badge variant="outline" className="font-mono">
                            {getTruckDisplay(user.assignedTruckId)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.lastLoginAt ? (
                          new Date(user.lastLoginAt).toLocaleString()
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span>Never</span>
                            {!user.passwordHash && user.email && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                title="Resend invitation email"
                                disabled={resendInvitation.isPending}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await resendInvitation.mutateAsync({
                                      orgId: user.organizationId,
                                      userId: user.id,
                                    });
                                    toast({
                                      title: "Invitation resent",
                                      description: `New 7-day invitation emailed to ${user.email}.`,
                                    });
                                  } catch (error: any) {
                                    toast({
                                      title: "Failed to resend invitation",
                                      description: error?.message ?? "Unknown error",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                data-testid={`button-resend-invitation-${user.id}`}
                              >
                                <Send className="h-3 w-3" />
                              </Button>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openAssignTruck(user)}
                          title="Assign Truck"
                          data-testid={`button-assign-truck-${user.id}`}
                        >
                          <Truck className="h-4 w-4" />
                        </Button>
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
              <DialogTitle>Invite User</DialogTitle>
              <DialogDescription>
                Send an invitation to a new user. They'll receive an email to set their password.
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
                    <SelectItem value="fleet_manager">Fleet Manager</SelectItem>
                    <SelectItem value="operator">Operator (Driver)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4" />
                <span>An invitation email will be sent so the user can set their own password</span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreate} 
                disabled={createUser.isPending || !createOrgId || !formData.email} 
                data-testid="button-submit-create"
              >
                {createUser.isPending ? "Sending Invite..." : "Send Invite"}
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
                    <SelectItem value="fleet_manager">Fleet Manager</SelectItem>
                    <SelectItem value="operator">Operator (Driver)</SelectItem>
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

        <Dialog open={!!assigningUser} onOpenChange={() => setAssigningUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Truck</DialogTitle>
              <DialogDescription>
                Assign a truck to {assigningUser?.email} for the mobile app.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="assign-truck">Truck</Label>
                <Select value={selectedTruckId} onValueChange={setSelectedTruckId}>
                  <SelectTrigger data-testid="select-assign-truck">
                    <SelectValue placeholder="Select a truck" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No truck assigned</SelectItem>
                    {trucks
                      .filter((truck) => truck.organizationId === assigningUser?.organizationId)
                      .map((truck) => (
                        <SelectItem key={truck.id} value={truck.id.toString()}>
                          {truck.truckNumber} - {truck.make} {truck.model}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  This truck will appear in the driver's mobile app
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssigningUser(null)}>
                Cancel
              </Button>
              <Button 
                onClick={handleAssignTruck} 
                disabled={assignTruck.isPending}
                data-testid="button-submit-assign-truck"
              >
                {assignTruck.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

// Manage Platform Admins (Task #8). Lists every user with is_platform_admin
// and lets an existing admin invite a new one (passwordless — the invitee
// gets a 7-day invitation token email and sets their own password). Self-
// revoke is blocked server-side; the UI hides the button entirely for the
// currently logged-in admin.
function PlatformAdminsCard() {
  const { toast } = useToast();
  const { data: session } = useAdminSession();
  const { data, isLoading } = usePlatformAdmins();
  const invite = useInvitePlatformAdmin();
  const revoke = useRevokePlatformAdmin();
  const resend = useResendPlatformAdminInvitation();

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", firstName: "", lastName: "" });
  const [revokeTarget, setRevokeTarget] = useState<PlatformAdminDto | null>(null);

  const admins = data?.admins ?? [];
  const currentEmail = session?.email ?? null;

  const submitInvite = async () => {
    try {
      const result = await invite.mutateAsync({
        email: inviteForm.email.trim().toLowerCase(),
        firstName: inviteForm.firstName.trim(),
        lastName: inviteForm.lastName.trim(),
      });
      if (result.alreadyExisted) {
        toast({
          title: "Existing user promoted",
          description: `${inviteForm.email} now has admin access.`,
        });
      } else if (result.invitationEmailSent) {
        toast({
          title: "Admin invited",
          description: `Invitation sent to ${inviteForm.email}.`,
        });
      } else {
        toast({
          title: "Admin created",
          description: "Email is not configured — share the password reset link manually.",
        });
      }
      setIsInviteOpen(false);
      setInviteForm({ email: "", firstName: "", lastName: "" });
    } catch (error: any) {
      toast({
        title: "Failed to invite admin",
        description: error?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  };

  const submitRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revoke.mutateAsync(revokeTarget.id);
      toast({
        title: "Admin access revoked",
        description: `${revokeTarget.email} can no longer sign in to /admin.`,
      });
      setRevokeTarget(null);
    } catch (error: any) {
      toast({
        title: "Failed to revoke",
        description: error?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground" data-testid="text-platform-admins-title">
                Platform Admins
              </h2>
              <Badge
                variant="secondary"
                className="bg-[#dedede] text-[#636363]"
                data-testid="badge-platform-admin-count"
              >
                {admins.length}
              </Badge>
            </div>
            <Button
              size="sm"
              onClick={() => setIsInviteOpen(true)}
              data-testid="button-invite-platform-admin"
            >
              <Plus className="h-4 w-4 mr-2" />
              Invite admin
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Users that can sign in at /admin/login. Admins are invited by email and set their
            own password.
          </p>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-2">Loading admins...</div>
          ) : admins.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">No platform admins yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((admin) => {
                  const isSelf = currentEmail && admin.email === currentEmail;
                  return (
                    <TableRow key={admin.id} data-testid={`row-platform-admin-${admin.id}`}>
                      <TableCell className="font-medium">{admin.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {[admin.firstName, admin.lastName].filter(Boolean).join(" ") || "-"}
                      </TableCell>
                      <TableCell>
                        {admin.hasPassword ? (
                          <Badge
                            className="rounded-md font-medium"
                            style={{ backgroundColor: "rgba(0, 201, 80, 0.14)", color: "#00953b" }}
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-[#dedede] text-[#636363]"
                          >
                            Pending invite
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {admin.lastLoginAt
                          ? new Date(admin.lastLoginAt).toLocaleString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">You</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            {!admin.hasPassword && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Resend invitation email"
                                disabled={resend.isPending}
                                onClick={async () => {
                                  try {
                                    await resend.mutateAsync(admin.id);
                                    toast({
                                      title: "Invitation resent",
                                      description: `New 7-day invitation emailed to ${admin.email}.`,
                                    });
                                  } catch (error: any) {
                                    toast({
                                      title: "Failed to resend invitation",
                                      description: error?.message ?? "Unknown error",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                data-testid={`button-resend-platform-admin-invite-${admin.id}`}
                              >
                                <Send className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setRevokeTarget(admin)}
                              data-testid={`button-revoke-platform-admin-${admin.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite platform admin</DialogTitle>
            <DialogDescription>
              The invitee receives a one-time link to set their password. The link expires in
              7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                data-testid="input-invite-admin-email"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="invite-first">First name</Label>
                <Input
                  id="invite-first"
                  value={inviteForm.firstName}
                  onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
                  data-testid="input-invite-admin-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-last">Last name</Label>
                <Input
                  id="invite-last"
                  value={inviteForm.lastName}
                  onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })}
                  data-testid="input-invite-admin-last-name"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitInvite}
              disabled={
                invite.isPending ||
                !inviteForm.email.trim() ||
                !inviteForm.firstName.trim() ||
                !inviteForm.lastName.trim()
              }
              data-testid="button-submit-invite-admin"
            >
              {invite.isPending ? "Inviting..." : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke admin access?</DialogTitle>
            <DialogDescription>
              {revokeTarget?.email} will no longer be able to sign in to /admin. Their user
              account is preserved so historical export jobs remain attributed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitRevoke}
              disabled={revoke.isPending}
              data-testid="button-confirm-revoke-platform-admin"
            >
              {revoke.isPending ? "Revoking..." : "Revoke access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
