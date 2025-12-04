import { db } from "../db";
import { deviceSnapshots, savingsConfig, trucks, powerMonDevices } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { eiaClient } from "./eia-client";
import { getPADDFromCoordinates, PADDRegion, getPADDRegionName } from "./padd-regions";

// Idle reduction constants - based on APU/idle fuel consumption
const GALLONS_PER_HOUR_IDLING = 1.2; // Diesel trucks consume ~1.2 gallons/hour idling
const CO2_LBS_PER_GALLON = 22.4; // Burning 1 gallon of diesel produces 22.4 lbs of CO2
const DEFAULT_FUEL_PRICE = 3.50;

interface TruckSavings {
  truckId: number;
  truckNumber: string;
  region: PADDRegion;
  regionName: string;
  fuelPrice: number;
  todayParkedMinutes: number;
  monthParkedMinutes: number;
  todayGallonsSaved: number;
  todaySavings: number;
  mtdGallonsSaved: number;
  mtdSavings: number;
  todayCO2Reduction: number;
  mtdCO2Reduction: number;
  isParked: boolean;
  chassisVoltage: number | null;
}

interface SavingsResult {
  todaySavings: number;
  todayGallonsSaved: number;
  todayCO2Reduction: number;
  todayParkedMinutes: number;
  mtdSavings: number;
  mtdGallonsSaved: number;
  mtdCO2Reduction: number;
  mtdParkedMinutes: number;
  currentFuelPrice: number;
  truckBreakdown: TruckSavings[];
  usesRegionalPricing: boolean;
  trucksParkedNow: number;
  trucksTotal: number;
}

export class SavingsCalculator {
  async getSavingsConfig(organizationId: number): Promise<{
    defaultFuelPrice: number;
    useLivePrices: boolean;
  }> {
    try {
      const [config] = await db
        .select()
        .from(savingsConfig)
        .where(eq(savingsConfig.organizationId, organizationId))
        .limit(1);

      if (config) {
        return {
          defaultFuelPrice: config.defaultFuelPricePerGallon ?? DEFAULT_FUEL_PRICE,
          useLivePrices: config.useLiveFuelPrices ?? true,
        };
      }
    } catch (error) {
      console.error("[SavingsCalculator] Failed to get config:", error);
    }

    return {
      defaultFuelPrice: DEFAULT_FUEL_PRICE,
      useLivePrices: true,
    };
  }

  /**
   * Calculate savings based on parked time (idle reduction)
   * Formula: savings = (parked_minutes / 60) × 1.2 gal/hr × diesel_price
   * CO2 reduction: gallons_saved × 22.4 lbs/gallon
   */
  async calculateSavings(organizationId: number): Promise<SavingsResult> {
    const config = await this.getSavingsConfig(organizationId);

    // Get all trucks with their snapshots and location data
    const trucksWithSnapshots = await db
      .select({
        truckId: trucks.id,
        truckNumber: trucks.truckNumber,
        latitude: trucks.latitude,
        longitude: trucks.longitude,
        deviceId: powerMonDevices.id,
        todayParkedMinutes: deviceSnapshots.todayParkedMinutes,
        monthParkedMinutes: deviceSnapshots.monthParkedMinutes,
        isParked: deviceSnapshots.isParked,
        voltage2: deviceSnapshots.voltage2,
      })
      .from(trucks)
      .leftJoin(powerMonDevices, eq(powerMonDevices.truckId, trucks.id))
      .leftJoin(deviceSnapshots, eq(deviceSnapshots.deviceId, powerMonDevices.id))
      .where(eq(trucks.organizationId, organizationId));

    // Determine if we can use regional pricing
    const trucksWithCoords = trucksWithSnapshots.filter(
      t => t.latitude !== null && t.longitude !== null
    );
    const usesRegionalPricing = trucksWithCoords.length > 0 && config.useLivePrices;

    let currentFuelPrice = config.defaultFuelPrice;
    let totalTodaySavings = 0;
    let totalTodayGallonsSaved = 0;
    let totalTodayCO2Reduction = 0;
    let totalTodayParkedMinutes = 0;
    let totalMtdSavings = 0;
    let totalMtdGallonsSaved = 0;
    let totalMtdCO2Reduction = 0;
    let totalMtdParkedMinutes = 0;
    let trucksParkedNow = 0;

    const truckBreakdown: TruckSavings[] = [];
    const regionPrices = new Map<PADDRegion, number>();

    // Get US average price as baseline
    if (config.useLivePrices) {
      currentFuelPrice = await eiaClient.getCurrentFuelPrice("US");
    }

    for (const truck of trucksWithSnapshots) {
      const todayParkedMinutes = truck.todayParkedMinutes ?? 0;
      // MTD = completed days (monthParkedMinutes) + today's minutes
      const mtdParkedMinutes = (truck.monthParkedMinutes ?? 0) + todayParkedMinutes;
      const isParked = truck.isParked ?? false;
      const chassisVoltage = truck.voltage2;

      if (isParked) {
        trucksParkedNow++;
      }

      // Determine fuel price for this truck (regional if available)
      let fuelPrice = currentFuelPrice;
      let region: PADDRegion = "US";

      if (usesRegionalPricing && truck.latitude !== null && truck.longitude !== null) {
        const paddInfo = getPADDFromCoordinates(truck.latitude, truck.longitude);
        region = paddInfo.code;

        // Cache regional prices
        let cachedPrice = regionPrices.get(region);
        if (cachedPrice === undefined) {
          cachedPrice = await eiaClient.getCurrentFuelPrice(region);
          regionPrices.set(region, cachedPrice);
        }
        fuelPrice = cachedPrice;
      }

      // Calculate today's savings
      const todayParkedHours = todayParkedMinutes / 60;
      const todayGallonsSaved = todayParkedHours * GALLONS_PER_HOUR_IDLING;
      const todaySavings = todayGallonsSaved * fuelPrice;
      const todayCO2Reduction = todayGallonsSaved * CO2_LBS_PER_GALLON;

      // Calculate MTD savings
      const mtdParkedHours = mtdParkedMinutes / 60;
      const mtdGallonsSaved = mtdParkedHours * GALLONS_PER_HOUR_IDLING;
      const mtdSavings = mtdGallonsSaved * fuelPrice;
      const mtdCO2Reduction = mtdGallonsSaved * CO2_LBS_PER_GALLON;

      // Accumulate totals
      totalTodayParkedMinutes += todayParkedMinutes;
      totalTodayGallonsSaved += todayGallonsSaved;
      totalTodaySavings += todaySavings;
      totalTodayCO2Reduction += todayCO2Reduction;
      totalMtdParkedMinutes += mtdParkedMinutes;
      totalMtdGallonsSaved += mtdGallonsSaved;
      totalMtdSavings += mtdSavings;
      totalMtdCO2Reduction += mtdCO2Reduction;

      truckBreakdown.push({
        truckId: truck.truckId,
        truckNumber: truck.truckNumber || `Truck-${truck.truckId}`,
        region,
        regionName: getPADDRegionName(region),
        fuelPrice,
        todayParkedMinutes,
        monthParkedMinutes: mtdParkedMinutes,
        todayGallonsSaved,
        todaySavings,
        mtdGallonsSaved,
        mtdSavings,
        todayCO2Reduction,
        mtdCO2Reduction,
        isParked,
        chassisVoltage,
      });
    }

    return {
      todaySavings: totalTodaySavings,
      todayGallonsSaved: totalTodayGallonsSaved,
      todayCO2Reduction: totalTodayCO2Reduction,
      todayParkedMinutes: totalTodayParkedMinutes,
      mtdSavings: totalMtdSavings,
      mtdGallonsSaved: totalMtdGallonsSaved,
      mtdCO2Reduction: totalMtdCO2Reduction,
      mtdParkedMinutes: totalMtdParkedMinutes,
      currentFuelPrice,
      truckBreakdown,
      usesRegionalPricing,
      trucksParkedNow,
      trucksTotal: trucksWithSnapshots.length,
    };
  }

  /**
   * Get savings for a specific truck
   */
  async getSavingsForTruck(
    organizationId: number,
    truckId: number
  ): Promise<TruckSavings | null> {
    const config = await this.getSavingsConfig(organizationId);

    try {
      const [truckData] = await db
        .select({
          truckId: trucks.id,
          truckNumber: trucks.truckNumber,
          latitude: trucks.latitude,
          longitude: trucks.longitude,
          deviceId: powerMonDevices.id,
          todayParkedMinutes: deviceSnapshots.todayParkedMinutes,
          monthParkedMinutes: deviceSnapshots.monthParkedMinutes,
          isParked: deviceSnapshots.isParked,
          voltage2: deviceSnapshots.voltage2,
        })
        .from(trucks)
        .leftJoin(powerMonDevices, eq(powerMonDevices.truckId, trucks.id))
        .leftJoin(deviceSnapshots, eq(deviceSnapshots.deviceId, powerMonDevices.id))
        .where(
          and(
            eq(trucks.organizationId, organizationId),
            eq(trucks.id, truckId)
          )
        );

      if (!truckData) {
        return null;
      }

      // Determine fuel price
      let fuelPrice = config.defaultFuelPrice;
      let region: PADDRegion = "US";

      if (config.useLivePrices) {
        fuelPrice = await eiaClient.getCurrentFuelPrice("US");
      }

      if (truckData.latitude !== null && truckData.longitude !== null && config.useLivePrices) {
        const paddInfo = getPADDFromCoordinates(truckData.latitude, truckData.longitude);
        region = paddInfo.code;
        fuelPrice = await eiaClient.getCurrentFuelPrice(region);
      }

      const todayParkedMinutes = truckData.todayParkedMinutes ?? 0;
      const mtdParkedMinutes = (truckData.monthParkedMinutes ?? 0) + todayParkedMinutes;

      // Calculate savings
      const todayParkedHours = todayParkedMinutes / 60;
      const todayGallonsSaved = todayParkedHours * GALLONS_PER_HOUR_IDLING;
      const todaySavings = todayGallonsSaved * fuelPrice;
      const todayCO2Reduction = todayGallonsSaved * CO2_LBS_PER_GALLON;

      const mtdParkedHours = mtdParkedMinutes / 60;
      const mtdGallonsSaved = mtdParkedHours * GALLONS_PER_HOUR_IDLING;
      const mtdSavings = mtdGallonsSaved * fuelPrice;
      const mtdCO2Reduction = mtdGallonsSaved * CO2_LBS_PER_GALLON;

      return {
        truckId: truckData.truckId,
        truckNumber: truckData.truckNumber || `Truck-${truckData.truckId}`,
        region,
        regionName: getPADDRegionName(region),
        fuelPrice,
        todayParkedMinutes,
        monthParkedMinutes: mtdParkedMinutes,
        todayGallonsSaved,
        todaySavings,
        mtdGallonsSaved,
        mtdSavings,
        todayCO2Reduction,
        mtdCO2Reduction,
        isParked: truckData.isParked ?? false,
        chassisVoltage: truckData.voltage2,
      };
    } catch (error) {
      console.error(`[SavingsCalculator] Failed to get savings for truck ${truckId}:`, error);
      return null;
    }
  }
}

export const savingsCalculator = new SavingsCalculator();
