import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Organization,
  Fleet,
  Truck,
  PowerMonDevice,
  User,
  DeviceCredential,
  DeviceSnapshot,
} from "@shared/schema";

export type DeviceWithSnapshot = PowerMonDevice & {
  snapshot?: DeviceSnapshot;
  // Router cellular signal in dBm, from the linked SIM (sims.router_rssi).
  // Null when no SIM is linked to the device or the InHand poller hasn't
  // reported a signal yet.
  routerRssi?: number | null;
  // Wall-clock of the most recent InHand poll that returned a router signal.
  // Feeds classifyFlappingVerdict() on the admin Devices page so the status
  // column can distinguish "PowerMon offline" from "Router/cellular outage".
  routerSignalUpdatedAt?: string | Date | null;
  // Latest GPS location of the assigned truck (from the InHand router poll).
  // Null when the device has no truck assigned or no GPS fix has landed yet.
  latitude?: number | null;
  longitude?: number | null;
  locationDescription?: string | null;
  lastLocationUpdate?: string | Date | null;
};

// Auto-refresh interval for admin dashboard (10 seconds, matching Fleet dashboard)
const ADMIN_POLL_INTERVAL = 10000;

interface AdminStatsResponse {
  stats: {
    totalOrganizations: number;
    totalFleets: number;
    totalTrucks: number;
    totalDevices: number;
    totalUsers: number;
    onlineDevices: number;
    offlineDevices: number;
    activeAlerts: number;
    totalStoredPower: number;
  };
}

interface OrganizationsResponse {
  organizations: Organization[];
}

interface OrganizationResponse {
  organization: Organization;
}

interface FleetsResponse {
  fleets: Fleet[];
}

interface FleetResponse {
  fleet: Fleet;
}

interface TrucksResponse {
  trucks: Truck[];
}

interface TruckResponse {
  truck: Truck;
}

interface DevicesResponse {
  devices: DeviceWithSnapshot[];
}

interface DeviceResponse {
  device: PowerMonDevice;
  // Optional fields populated by POST /organizations/:orgId/devices when
  // the synchronous SIM lookup succeeded (Task #21).
  sim?: { iccid: string; msisdn: string; deviceName: string };
  message?: string;
}

interface UsersResponse {
  users: User[];
}

interface UserResponse {
  user: User;
}

// Error subclass that preserves the structured `code` from the server so
// callers (e.g. the Register Device form) can branch on machine-readable
// codes like `SIM_NOT_FOUND` / `SIM_MULTIPLE_MATCH` instead of brittle
// string-matching the human message.
export class AdminApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

async function adminFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    if (res.status === 401) {
      window.location.href = "/admin/login";
      throw new Error("Session expired. Redirecting to login...");
    }
    throw new AdminApiError(
      error.error || error.message || "Request failed",
      res.status,
      error.code,
    );
  }
  return res.json();
}

interface AdminSession {
  // Server returns isPlatformAdmin as the canonical flag (Task #8). isAdmin
  // is kept as a temporary backward-compat alias while the rest of the
  // frontend migrates off the old name.
  isPlatformAdmin: boolean;
  isAdmin?: boolean;
  email?: string | null;
  name?: string | null;
}

export function useAdminSession() {
  return useQuery<AdminSession>({
    queryKey: ["/api/v1/admin/session"],
    queryFn: async () => {
      const res = await fetch("/api/v1/admin/session", { credentials: "include" });
      return res.json();
    },
    staleTime: 60000,
  });
}

export function useAdminLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const res = await fetch("/api/v1/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || error.message || "Login failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/session"] });
    },
  });
}

// Sanitized DTO matching the server's `toPlatformAdminDto`. We deliberately
// drop `passwordHash` and other sensitive User fields and add `hasPassword`
// as a boolean derived signal so the UI can show "Active" vs "Pending invite"
// without ever seeing the bcrypt hash itself.
export interface PlatformAdminDto {
  id: number;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isActive: boolean;
  isPlatformAdmin: boolean;
  organizationId: number;
  lastLoginAt: string | null;
  hasPassword: boolean;
}

interface PlatformAdminsResponse {
  admins: PlatformAdminDto[];
}

export function usePlatformAdmins() {
  return useQuery<PlatformAdminsResponse>({
    queryKey: ["/api/v1/admin/platform-admins"],
    queryFn: () => adminFetch("/api/v1/admin/platform-admins"),
  });
}

export function useInvitePlatformAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; firstName: string; lastName: string }) =>
      adminFetch<{ user: PlatformAdminDto; invitationEmailSent?: boolean; alreadyExisted?: boolean }>(
        "/api/v1/admin/platform-admins",
        { method: "POST", body: JSON.stringify(data) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/platform-admins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
    },
  });
}

export function useResendPlatformAdminInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ invitationEmailSent: boolean; expiresAt: string }>(
        `/api/v1/admin/platform-admins/${id}/resend-invitation`,
        { method: "POST" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/platform-admins"] });
    },
  });
}

export function useResendUserInvitation(orgId?: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId: targetOrgId, userId }: { orgId: number; userId: number }) =>
      adminFetch<{ invitationEmailSent: boolean; expiresAt: string }>(
        `/api/v1/admin/organizations/${targetOrgId}/users/${userId}/resend-invitation`,
        { method: "POST" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/v1/admin/organizations", orgId, "users"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
    },
  });
}

export function useRevokePlatformAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ success: boolean }>(`/api/v1/admin/platform-admins/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/platform-admins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
    },
  });
}

export function useAdminLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/v1/admin/logout", {
        method: "POST",
        credentials: "include",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/session"] });
    },
  });
}

export function useAdminStats() {
  return useQuery<AdminStatsResponse>({
    queryKey: ["/api/v1/admin/stats"],
    queryFn: () => adminFetch("/api/v1/admin/stats"),
    refetchInterval: ADMIN_POLL_INTERVAL,
  });
}

export function useAdminOrganizations() {
  return useQuery<OrganizationsResponse>({
    queryKey: ["/api/v1/admin/organizations"],
    queryFn: () => adminFetch("/api/v1/admin/organizations"),
    refetchInterval: ADMIN_POLL_INTERVAL,
  });
}

export function useAdminOrganization(id: number | undefined) {
  return useQuery<OrganizationResponse>({
    queryKey: ["/api/v1/admin/organizations", id],
    queryFn: () => adminFetch(`/api/v1/admin/organizations/${id}`),
    enabled: !!id,
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Organization>) =>
      adminFetch<OrganizationResponse>("/api/v1/admin/organizations", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Organization> }) =>
      adminFetch<OrganizationResponse>(`/api/v1/admin/organizations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations"] });
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/api/v1/admin/organizations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export function useAdminFleets(orgId: number | undefined) {
  return useQuery<FleetsResponse>({
    queryKey: ["/api/v1/admin/organizations", orgId, "fleets"],
    queryFn: () => adminFetch(`/api/v1/admin/organizations/${orgId}/fleets`),
    enabled: !!orgId,
  });
}

export function useCreateFleet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: { orgId: number; data: Partial<Fleet> }) =>
      adminFetch<FleetResponse>(`/api/v1/admin/organizations/${orgId}/fleets`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "fleets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export function useUpdateFleet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, orgId, data }: { id: number; orgId: number; data: Partial<Fleet> }) =>
      adminFetch<FleetResponse>(`/api/v1/admin/fleets/${id}?orgId=${orgId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "fleets"] });
    },
  });
}

export function useDeleteFleet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, orgId }: { id: number; orgId: number }) =>
      adminFetch(`/api/v1/admin/fleets/${id}?orgId=${orgId}`, { method: "DELETE" }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "fleets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export function useAdminTrucks(orgId: number | undefined, fleetId?: number) {
  const params = fleetId ? `?fleetId=${fleetId}` : "";
  return useQuery<TrucksResponse>({
    queryKey: ["/api/v1/admin/organizations", orgId, "trucks", fleetId],
    queryFn: () => adminFetch(`/api/v1/admin/organizations/${orgId}/trucks${params}`),
    enabled: !!orgId,
  });
}

export function useAllAdminTrucks() {
  return useQuery<TrucksResponse>({
    queryKey: ["/api/v1/admin/trucks"],
    queryFn: () => adminFetch(`/api/v1/admin/trucks`),
  });
}

export function useCreateTruck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: { orgId: number; data: Partial<Truck> }) =>
      adminFetch<TruckResponse>(`/api/v1/admin/organizations/${orgId}/trucks`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "trucks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export function useUpdateTruck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, orgId, data }: { id: number; orgId: number; data: Partial<Truck> }) =>
      adminFetch<TruckResponse>(`/api/v1/admin/trucks/${id}?orgId=${orgId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "trucks"] });
    },
  });
}

export function useDeleteTruck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, orgId }: { id: number; orgId: number }) =>
      adminFetch(`/api/v1/admin/trucks/${id}?orgId=${orgId}`, { method: "DELETE" }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "trucks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export function useAdminDevices(orgId?: number) {
  if (orgId) {
    return useQuery<DevicesResponse>({
      queryKey: ["/api/v1/admin/organizations", orgId, "devices"],
      queryFn: () => adminFetch(`/api/v1/admin/organizations/${orgId}/devices`),
      enabled: !!orgId,
      refetchInterval: ADMIN_POLL_INTERVAL,
    });
  }
  return useQuery<DevicesResponse>({
    queryKey: ["/api/v1/admin/devices"],
    queryFn: () => adminFetch("/api/v1/admin/devices"),
    refetchInterval: ADMIN_POLL_INTERVAL,
  });
}

export function useCreateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: { orgId: number; data: Partial<PowerMonDevice> }) =>
      adminFetch<DeviceResponse>(`/api/v1/admin/organizations/${orgId}/devices`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export interface SimBackfillSummary {
  scanned: number;
  linked: number;
  skipped_no_name: string[];
  failed_no_match: string[];
  failed_multiple_match: string[];
  failed_already_linked: string[];
  failed_api_error: { name: string; error: string }[];
}

export function useBackfillSimLinks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      adminFetch<SimBackfillSummary>(`/api/v1/admin/devices/backfill-sim-links`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
    },
  });
}

export interface RefreshSimResult {
  device: { id: number; deviceName: string };
  before: { iccid: string; msisdn: string | null; imsi: string | null } | null;
  after: { iccid: string; msisdn: string | null; imsi: string | null };
  iccidChanged: boolean;
  message: string;
}

export function useRefreshDeviceSim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: number) =>
      adminFetch<RefreshSimResult>(`/api/v1/admin/devices/${deviceId}/refresh-sim`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
    },
  });
}

export function useUpdateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, orgId, data }: { id: number; orgId: number; data: Partial<PowerMonDevice> }) =>
      adminFetch<DeviceResponse>(`/api/v1/admin/devices/${id}?orgId=${orgId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "devices"] });
    },
  });
}

export function useAssignDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, truckId, organizationId }: { id: number; truckId: number; organizationId: number }) =>
      adminFetch<DeviceResponse>(`/api/v1/admin/devices/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ truckId, organizationId }),
      }),
    onSuccess: (_, { organizationId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", organizationId, "devices"] });
    },
  });
}

export function useUnassignDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, organizationId }: { id: number; organizationId: number }) =>
      adminFetch<DeviceResponse>(`/api/v1/admin/devices/${id}/unassign`, {
        method: "POST",
        body: JSON.stringify({ organizationId }),
      }),
    onSuccess: (_, { organizationId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", organizationId, "devices"] });
    },
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, organizationId }: { id: number; organizationId: number }) =>
      adminFetch<{ success: boolean }>(`/api/v1/admin/devices/${id}?orgId=${organizationId}`, {
        method: "DELETE",
      }),
    onSuccess: (_, { organizationId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", organizationId, "devices"] });
    },
  });
}

export function useResetDeviceStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      adminFetch<PowerMonDevice>(`/api/v1/admin/devices/${id}/reset-status`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
    },
  });
}

export function useSetDeviceOffline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      adminFetch<PowerMonDevice>(`/api/v1/admin/devices/${id}/set-offline`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
    },
  });
}

export function useAdminUsers(orgId?: number) {
  const queryKey = orgId 
    ? ["/api/v1/admin/organizations", orgId, "users"]
    : ["/api/v1/admin/users"];
  const url = orgId 
    ? `/api/v1/admin/organizations/${orgId}/users`
    : "/api/v1/admin/users";
  
  return useQuery<UsersResponse>({
    queryKey,
    queryFn: () => adminFetch(url),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: { orgId: number; data: Partial<User> }) =>
      adminFetch<UserResponse & { invitationEmailSent?: boolean }>(`/api/v1/admin/organizations/${orgId}/users?sendInvitation=true`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, orgId, data }: { id: number; orgId: number; data: Partial<User> }) =>
      adminFetch<UserResponse>(`/api/v1/admin/users/${id}?orgId=${orgId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations"] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, orgId }: { id: number; orgId: number }) =>
      adminFetch(`/api/v1/admin/users/${id}?orgId=${orgId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}

export function useAssignTruckToUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, orgId, truckId }: { userId: number; orgId: number; truckId: number | null }) =>
      adminFetch<UserResponse>(`/api/v1/admin/users/${userId}/assign-truck?orgId=${orgId}`, {
        method: "PATCH",
        body: JSON.stringify({ truckId }),
      }),
    onSuccess: (_, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/organizations", orgId, "users"] });
    },
  });
}

interface CredentialResponse {
  credential: DeviceCredential;
}

export function useDeviceCredential(deviceId: number | undefined, orgId: number | undefined) {
  return useQuery<CredentialResponse>({
    queryKey: ["/api/v1/admin/devices", deviceId, "credentials", orgId],
    queryFn: () => adminFetch(`/api/v1/admin/devices/${deviceId}/credentials?orgId=${orgId}`),
    enabled: !!deviceId && !!orgId,
    retry: false,
  });
}

export function useCreateDeviceCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, organizationId, applinkUrl }: { deviceId: number; organizationId: number; applinkUrl: string }) =>
      adminFetch<CredentialResponse>(`/api/v1/admin/devices/${deviceId}/credentials`, {
        method: "POST",
        body: JSON.stringify({ organizationId, applinkUrl }),
      }),
    onSuccess: (_, { deviceId, organizationId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices", deviceId, "credentials", organizationId] });
    },
  });
}

export function useUpdateDeviceCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, organizationId, applinkUrl, isActive }: { deviceId: number; organizationId: number; applinkUrl?: string; isActive?: boolean }) =>
      adminFetch<CredentialResponse>(`/api/v1/admin/devices/${deviceId}/credentials`, {
        method: "PATCH",
        body: JSON.stringify({ organizationId, applinkUrl, isActive }),
      }),
    onSuccess: (_, { deviceId, organizationId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices", deviceId, "credentials", organizationId] });
    },
  });
}

