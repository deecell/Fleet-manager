import { z } from "zod";

// Truck schema
export const truckSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  serial: z.string(),
  fw: z.string(),
  v1: z.number(),
  v2: z.number(),
  p: z.number(),
  wh: z.number(),
  ah: z.number(),
  temp: z.number(),
  soc: z.number(),
  runtime: z.number(),
  ps: z.string(),
  address: z.string(),
  x: z.string(),
  rssi: z.number(),
  status: z.enum(["in-service", "not-in-service"]),
  latitude: z.number(),
  longitude: z.number(),
});

export type Truck = z.infer<typeof truckSchema>;

// Historical data point schema
export const historicalDataPointSchema = z.object({
  timestamp: z.number(),
  soc: z.number(),
  voltage: z.number(),
  current: z.number(),
  watts: z.number(),
});

export type HistoricalDataPoint = z.infer<typeof historicalDataPointSchema>;

// Truck with historical data
export const truckWithHistorySchema = truckSchema.extend({
  history: z.array(historicalDataPointSchema),
});

export type TruckWithHistory = z.infer<typeof truckWithHistorySchema>;
