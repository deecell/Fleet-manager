import { useQuery } from "@tanstack/react-query";
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
  return useQuery<TrucksResponse>({
    queryKey: ["/api/v1/trucks" + buildQueryString(options)],
    refetchInterval: POLL_INTERVAL,
  });
}

export function useDashboardStats() {
  return useQuery<DashboardStatsResponse>({
    queryKey: ["/api/v1/dashboard/stats"],
    refetchInterval: POLL_INTERVAL,
  });
}

export function useDevices() {
  return useQuery<DevicesResponse>({
    queryKey: ["/api/v1/devices"],
    refetchInterval: POLL_INTERVAL,
  });
}

export function useSnapshots() {
  return useQuery<SnapshotsResponse>({
    queryKey: ["/api/v1/snapshots"],
    refetchInterval: POLL_INTERVAL,
  });
}

export function useAlerts() {
  return useQuery<AlertsResponse>({
    queryKey: ["/api/v1/alerts"],
    refetchInterval: POLL_INTERVAL,
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

export interface LegacyTruckWithDevice extends LegacyTruckWithHistory {
  deviceId?: number;
}

export function useLegacyTrucks() {
  const trucksQuery = useTrucks();
  const devicesQuery = useDevices();
  const snapshotsQuery = useSnapshots();

  const isLoading = trucksQuery.isLoading || devicesQuery.isLoading || snapshotsQuery.isLoading;
  const isError = trucksQuery.isError || devicesQuery.isError || snapshotsQuery.isError;

  const legacyTrucks: LegacyTruckWithDevice[] = (trucksQuery.data?.trucks || []).map(truck => {
    const device = devicesQuery.data?.devices?.find(d => d.truckId === truck.id);
    const snapshot = device ? snapshotsQuery.data?.snapshots?.find(s => s.deviceId === device.id) : undefined;
    
    const tempCelsius = snapshot?.temperature ?? 25;
    const tempFahrenheit = (tempCelsius * 9/5) + 32;
    
    const truckModel = [truck.make, truck.model, truck.year].filter(Boolean).join(" ") || "Unknown Model";
    
    return {
      id: String(truck.id),
      name: truck.truckNumber || `Truck-${truck.id}`,
      model: truckModel,
      serial: device?.serialNumber || `SN-${truck.id}`,
      fw: device?.firmwareVersion || "1.0.0",
      v1: snapshot?.voltage1 ?? 0,
      v2: snapshot?.voltage2 ?? 0,
      p: (snapshot?.power ?? 0) / 1000,
      wh: snapshot?.energy ?? 0,
      ah: snapshot?.charge ?? 0,
      temp: tempFahrenheit,
      soc: snapshot?.soc ?? 0,
      runtime: snapshot?.runtime ?? 0,
      ps: truck.status === "in-service" ? "Active" : "Standby",
      address: truck.driverName || "Unknown Driver",
      x: "0",
      rssi: snapshot?.rssi ?? -50,
      status: truck.status as "in-service" | "not-in-service",
      latitude: truck.latitude ?? 0,
      longitude: truck.longitude ?? 0,
      history: [],
      deviceId: device?.id,
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
  const startDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const measurementsQuery = useDeviceMeasurements(deviceId, { limit: 500, startDate });
  
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
