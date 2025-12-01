import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Organization,
  Fleet,
  Truck,
  PowerMonDevice,
  User,
} from "@shared/schema";

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
  devices: PowerMonDevice[];
}

interface DeviceResponse {
  device: PowerMonDevice;
}

interface UsersResponse {
  users: User[];
}

interface UserResponse {
  user: User;
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
    throw new Error(error.error || error.message || "Request failed");
  }
  return res.json();
}

interface AdminSession {
  isAdmin: boolean;
  email?: string;
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
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await fetch("/api/v1/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
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
  });
}

export function useAdminOrganizations() {
  return useQuery<OrganizationsResponse>({
    queryKey: ["/api/v1/admin/organizations"],
    queryFn: () => adminFetch("/api/v1/admin/organizations"),
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
    });
  }
  return useQuery<DevicesResponse>({
    queryKey: ["/api/v1/admin/devices"],
    queryFn: () => adminFetch("/api/v1/admin/devices"),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/devices"] });
    },
  });
}

export function useAdminUsers(orgId?: number) {
  if (orgId) {
    return useQuery<UsersResponse>({
      queryKey: ["/api/v1/admin/organizations", orgId, "users"],
      queryFn: () => adminFetch(`/api/v1/admin/organizations/${orgId}/users`),
      enabled: !!orgId,
    });
  }
  return useQuery<UsersResponse>({
    queryKey: ["/api/v1/admin/users"],
    queryFn: () => adminFetch("/api/v1/admin/users"),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: { orgId: number; data: Partial<User> }) =>
      adminFetch<UserResponse>(`/api/v1/admin/organizations/${orgId}/users`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/users"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/stats"] });
    },
  });
}
