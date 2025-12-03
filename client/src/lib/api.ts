import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./queryClient";
import { useOrganization } from "./org-context";
import type { 
  Truck, PowerMonDevice, DeviceSnapshot, DeviceMeasurement, Alert,
  LegacyTruckWithHistory, LegacyHistoricalDataPoint, LegacyNotification
} from "@shared/schema";

interface TrucksResponse {
  trucks: Truck[];
  total: number;
}

interface DashboardStatsResponse {
  stats: {
    totalTrucks: number;
    inServiceCount: number;
    notInServiceCount: number;
    onlineDevices: number;
    offlineDevices: number;
    avgSoc: number;
    avgVoltage: number;
    lowVoltageCount: number;
  };
}

interface SnapshotsResponse {
  snapshots: DeviceSnapshot[];
}

interface DevicesResponse {
  devices: PowerMonDevice[];
}

interface AlertsResponse {
  alerts: Alert[];
}

interface MeasurementsResponse {
  measurements: DeviceMeasurement[];
  total: number;
  startTime: string;
  endTime: string;
}

const POLL_INTERVAL = 10000;

export function useTrucks(options?: { fleetId?: number; status?: string }) {
  const { organizationId } = useOrganization();
  return useQuery<TrucksResponse>({
    queryKey: ["/api/v1/trucks" + buildQueryString(options), "org", organizationId],
    refetchInterval: POLL_INTERVAL,
    enabled: !!organizationId,
  });
}

export function useDashboardStats() {
  const { organizationId } = useOrganization();
  return useQuery<DashboardStatsResponse>({
    queryKey: ["/api/v1/dashboard/stats", "org", organizationId],
    refetchInterval: POLL_INTERVAL,
    enabled: !!organizationId,
  });
}

export function useDevices() {
  const { organizationId } = useOrganization();
  return useQuery<DevicesResponse>({
    queryKey: ["/api/v1/devices", "org", organizationId],
    refetchInterval: POLL_INTERVAL,
    enabled: !!organizationId,
  });
}

export function useSnapshots() {
  const { organizationId } = useOrganization();
  return useQuery<SnapshotsResponse>({
    queryKey: ["/api/v1/snapshots", "org", organizationId],
    refetchInterval: POLL_INTERVAL,
    enabled: !!organizationId,
  });
}

export function useAlerts() {
  const { organizationId } = useOrganization();
  return useQuery<AlertsResponse>({
    queryKey: ["/api/v1/alerts", "org", organizationId],
    refetchInterval: POLL_INTERVAL,
    enabled: !!organizationId,
  });
}

export function useDeviceMeasurements(deviceId: number | undefined, options?: { limit?: number; startDate?: string }) {
  return useQuery<MeasurementsResponse>({
    queryKey: [`/api/v1/devices/${deviceId}/measurements` + buildQueryString(options)],
    enabled: !!deviceId,
  });
}

function buildQueryString(params?: Record<string, unknown>): string {
  if (!params) return "";
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });
  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

function mapMeasurementsToHistory(measurements: DeviceMeasurement[]): LegacyHistoricalDataPoint[] {
  return measurements.map(m => ({
    timestamp: new Date(m.recordedAt).getTime(),
    soc: m.soc ?? 0,
    voltage: m.voltage1 ?? 0,
    current: m.current ?? 0,
    watts: m.power ?? 0,
  }));
}

function formatLocation(lat: number | null, lng: number | null): string {
  if (!lat || !lng) return "Location unavailable";
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

export interface LegacyTruckWithDevice extends LegacyTruckWithHistory {
  deviceId?: number;
  lastUpdated?: string;
  isParked?: boolean;
  todayParkedMinutes?: number;
  fuelSavings?: number;
}

// Fuel savings constants
const GALLONS_PER_HOUR_IDLING = 1.2;
const DEFAULT_DIESEL_PRICE = 3.50;

export function useLegacyTrucks() {
  const trucksQuery = useTrucks();
  const devicesQuery = useDevices();
  const snapshotsQuery = useSnapshots();

  const isLoading = trucksQuery.isLoading || devicesQuery.isLoading || snapshotsQuery.isLoading;
  const isError = trucksQuery.isError || devicesQuery.isError || snapshotsQuery.isError;

  const legacyTrucks: LegacyTruckWithDevice[] = (trucksQuery.data?.trucks || []).map(truck => {
    const device = devicesQuery.data?.devices?.find(d => d.truckId === truck.id);
    const snapshot = device ? snapshotsQuery.data?.snapshots?.find(s => s.deviceId === device.id) : undefined;
    
    const tempCelsius = snapshot?.temperature ?? null;
    const tempFahrenheit = tempCelsius !== null ? (tempCelsius * 9/5) + 32 : 0;
    
    const truckModel = [truck.make, truck.model, truck.year].filter(Boolean).join(" ") || "Unknown Model";
    
    // Calculate kWh from battery specs: ((V * Ah) * numBatteries) * SoC / 1000
    const batteryVoltage = device?.batteryVoltage ?? 25.6;
    const batteryAh = device?.batteryAh ?? 200;
    const numberOfBatteries = device?.numberOfBatteries ?? 2;
    const soc = snapshot?.soc ?? 0;
    const calculatedKwh = ((batteryVoltage * batteryAh) * numberOfBatteries) * (soc / 100) / 1000;
    
    // Parked status and fuel savings calculation
    // Fuel Savings = (parkedMinutes / 60) * 1.2 gal/hr * diesel price
    const isParked = snapshot?.isParked ?? false;
    const todayParkedMinutes = snapshot?.todayParkedMinutes ?? 0;
    const parkedHours = todayParkedMinutes / 60;
    const gallonsSaved = parkedHours * GALLONS_PER_HOUR_IDLING;
    const fuelSavings = gallonsSaved * DEFAULT_DIESEL_PRICE;
    
    return {
      id: String(truck.id),
      name: truck.truckNumber || `Truck-${truck.id}`,
      model: truckModel,
      serial: device?.serialNumber || `SN-${truck.id}`,
      fw: device?.firmwareVersion || "1.0.0",
      v1: snapshot?.voltage1 ?? 0,
      v2: snapshot?.voltage2 ?? 0,
      p: (snapshot?.power ?? 0) / 1000,
      wh: calculatedKwh,
      ah: snapshot?.charge ?? 0,
      temp: tempFahrenheit,
      soc: snapshot?.soc ?? 0,
      runtime: snapshot?.runtime ?? 0,
      ps: truck.status === "in-service" ? "Active" : "Standby",
      driver: truck.driverName || "Unknown Driver",
      address: formatLocation(truck.latitude, truck.longitude),
      x: "0",
      rssi: snapshot?.rssi ?? -50,
      status: truck.status as "in-service" | "not-in-service",
      latitude: truck.latitude ?? 0,
      longitude: truck.longitude ?? 0,
      history: [],
      deviceId: device?.id,
      lastUpdated: snapshot?.updatedAt ? String(snapshot.updatedAt) : snapshot?.recordedAt ? String(snapshot.recordedAt) : undefined,
      isParked,
      todayParkedMinutes,
      fuelSavings,
    };
  });

  return {
    data: legacyTrucks,
    isLoading,
    isError,
    refetch: () => {
      trucksQuery.refetch();
      devicesQuery.refetch();
      snapshotsQuery.refetch();
    },
  };
}

export function useLegacyNotifications() {
  const alertsQuery = useAlerts();
  const trucksQuery = useTrucks();

  const isLoading = alertsQuery.isLoading || trucksQuery.isLoading;
  const isError = alertsQuery.isError || trucksQuery.isError;

  const notifications: LegacyNotification[] = (alertsQuery.data?.alerts || [])
    .filter(alert => alert.status !== "resolved")
    .map(alert => {
      const truck = trucksQuery.data?.trucks?.find(t => t.id === alert.truckId);
      return {
        id: String(alert.id),
        type: alert.severity === "critical" ? "alert" as const : 
              alert.severity === "warning" ? "warning" as const : "info" as const,
        title: alert.title,
        message: alert.message || "",
        truckId: alert.truckId ? String(alert.truckId) : undefined,
        truckName: truck?.truckNumber,
        timestamp: new Date(alert.createdAt!).getTime(),
        read: alert.status === "acknowledged",
      };
    });

  return {
    data: notifications,
    isLoading,
    isError,
    refetch: () => {
      alertsQuery.refetch();
      trucksQuery.refetch();
    },
  };
}

export function useTruckHistory(deviceId: number | undefined) {
  const measurementsQuery = useQuery<MeasurementsResponse>({
    queryKey: ["/api/v1/devices", deviceId, "measurements", "history"],
    queryFn: async () => {
      const startDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const res = await fetch(`/api/v1/devices/${deviceId}/measurements?limit=500&startDate=${startDate}`, {
        headers: {
          "X-Organization-Id": "6",
        },
      });
      if (!res.ok) throw new Error("Failed to fetch measurements");
      return res.json();
    },
    enabled: !!deviceId,
    staleTime: 30000,
  });
  
  const history: LegacyHistoricalDataPoint[] = measurementsQuery.data?.measurements 
    ? mapMeasurementsToHistory(measurementsQuery.data.measurements)
    : [];

  return {
    data: history,
    isLoading: measurementsQuery.isLoading,
    isError: measurementsQuery.isError,
    refetch: measurementsQuery.refetch,
  };
}

export interface TruckEvent {
  id: string;
  type: "alert" | "maintenance" | "route" | "status";
  category: string;
  title: string;
  description: string;
  severity?: string;
  status?: string;
  timestamp: Date | string;
  resolvedAt?: Date | string | null;
  acknowledgedAt?: Date | string | null;
}

interface TruckEventsResponse {
  events: TruckEvent[];
  total: number;
}

export function useTruckEvents(truckId: number | undefined, options?: { limit?: number }) {
  const params = options ? `?limit=${options.limit || 50}` : "";
  return useQuery<TruckEventsResponse>({
    queryKey: ["/api/v1/trucks", truckId, "events"],
    queryFn: async () => {
      const res = await fetch(`/api/v1/trucks/${truckId}/events${params}`, {
        headers: {
          "X-Organization-Id": "6",
        },
      });
      if (!res.ok) throw new Error("Failed to fetch truck events");
      return res.json();
    },
    enabled: !!truckId,
  });
}

export function useAcknowledgeAlert() {
  return useMutation({
    mutationFn: async ({ alertId, userId }: { alertId: number; userId: number }) => {
      const response = await apiRequest("POST", `/api/v1/alerts/${alertId}/acknowledge`, { userId });
      if (!response.ok) {
        throw new Error("Failed to acknowledge alert");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] });
    },
  });
}

export function useResolveAlert() {
  return useMutation({
    mutationFn: async (alertId: number) => {
      const response = await apiRequest("POST", `/api/v1/alerts/${alertId}/resolve`, {});
      if (!response.ok) {
        throw new Error("Failed to resolve alert");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/alerts"] });
    },
  });
}
