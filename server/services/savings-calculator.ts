import { db } from "../db";
import { deviceMeasurements, savingsConfig, trucks, powerMonDevices } from "@shared/schema";
import { eq, and, gte, lte, sql, isNotNull } from "drizzle-orm";
import { eiaClient } from "./eia-client";
import { getPADDFromCoordinates, PADDRegion, getPADDRegionName } from "./padd-regions";

const DEFAULT_DIESEL_KWH_PER_GALLON = 9.0;

interface DailySavings {
  date: string;
  totalWhSolar: number;
  fuelSavedGallons: number;
  savings: number;
  fuelPriceUsed: number;
}

interface TruckSavings {
  truckId: number;
  truckNumber: string;
  region: PADDRegion;
  regionName: string;
  fuelPrice: number;
  solarWh: number;
  gallonsSaved: number;
  savings: number;
}

interface SavingsResult {
  todaySavings: number;
  todayWhSolar: number;
  todayGallonsSaved: number;
  last7DaysAverage: number;
  trendPercentage: number;
  trendIsPositive: boolean;
  trendDollarAmount: number;
  currentFuelPrice: number;
  dailyBreakdown: DailySavings[];
  truckBreakdown?: TruckSavings[];
  usesRegionalPricing: boolean;
}

export class SavingsCalculator {
  async getSavingsConfig(organizationId: number): Promise<{
    dieselKwhPerGallon: number;
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
          dieselKwhPerGallon: config.dieselKwhPerGallon ?? DEFAULT_DIESEL_KWH_PER_GALLON,
          defaultFuelPrice: config.defaultFuelPricePerGallon ?? 3.50,
          useLivePrices: config.useLiveFuelPrices ?? true,
        };
      }
    } catch (error) {
      console.error("[SavingsCalculator] Failed to get config:", error);
    }

    return {
      dieselKwhPerGallon: DEFAULT_DIESEL_KWH_PER_GALLON,
      defaultFuelPrice: 3.50,
      useLivePrices: true,
    };
  }

  async getTrucksWithLocations(organizationId: number): Promise<Array<{
    truckId: number;
    truckNumber: string;
    latitude: number | null;
    longitude: number | null;
    deviceId: number | null;
  }>> {
    try {
      const result = await db
        .select({
          truckId: trucks.id,
          truckNumber: trucks.truckNumber,
          latitude: trucks.latitude,
          longitude: trucks.longitude,
          deviceId: powerMonDevices.id,
        })
        .from(trucks)
        .leftJoin(powerMonDevices, eq(powerMonDevices.truckId, trucks.id))
        .where(eq(trucks.organizationId, organizationId));

      return result;
    } catch (error) {
      console.error("[SavingsCalculator] Failed to get trucks with locations:", error);
      return [];
    }
  }

  async getTodaySolarEnergy(organizationId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    return this.getSolarEnergyForPeriod(organizationId, today, tomorrow);
  }

  async getTodaySolarEnergyByDevice(organizationId: number): Promise<Map<number, number>> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    return this.getSolarEnergyByDeviceForPeriod(organizationId, today, tomorrow);
  }

  async getDailySolarEnergy(organizationId: number, date: Date): Promise<number> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return this.getSolarEnergyForPeriod(organizationId, startOfDay, endOfDay);
  }

  private async getSolarEnergyForPeriod(
    organizationId: number, 
    startDate: Date, 
    endDate: Date
  ): Promise<number> {
    try {
      const result = await db
        .select({
          deviceId: deviceMeasurements.deviceId,
          maxEnergy: sql<number>`MAX(${deviceMeasurements.energy})`,
          minEnergy: sql<number>`MIN(${deviceMeasurements.energy})`,
        })
        .from(deviceMeasurements)
        .where(
          and(
            eq(deviceMeasurements.organizationId, organizationId),
            gte(deviceMeasurements.recordedAt, startDate),
            lte(deviceMeasurements.recordedAt, endDate)
          )
        )
        .groupBy(deviceMeasurements.deviceId);

      let totalEnergy = 0;
      for (const row of result) {
        const maxEnergy = row.maxEnergy || 0;
        const minEnergy = row.minEnergy || 0;
        totalEnergy += Math.max(0, maxEnergy - minEnergy);
      }
      
      return totalEnergy;
    } catch (error) {
      console.error("[SavingsCalculator] Failed to get solar energy for period:", error);
      return 0;
    }
  }

  private async getSolarEnergyByDeviceForPeriod(
    organizationId: number,
    startDate: Date,
    endDate: Date
  ): Promise<Map<number, number>> {
    const energyByDevice = new Map<number, number>();

    try {
      const result = await db
        .select({
          deviceId: deviceMeasurements.deviceId,
          maxEnergy: sql<number>`MAX(${deviceMeasurements.energy})`,
          minEnergy: sql<number>`MIN(${deviceMeasurements.energy})`,
        })
        .from(deviceMeasurements)
        .where(
          and(
            eq(deviceMeasurements.organizationId, organizationId),
            gte(deviceMeasurements.recordedAt, startDate),
            lte(deviceMeasurements.recordedAt, endDate)
          )
        )
        .groupBy(deviceMeasurements.deviceId);

      for (const row of result) {
        const maxEnergy = row.maxEnergy || 0;
        const minEnergy = row.minEnergy || 0;
        const energy = Math.max(0, maxEnergy - minEnergy);
        energyByDevice.set(row.deviceId, energy);
      }
    } catch (error) {
      console.error("[SavingsCalculator] Failed to get solar energy by device:", error);
    }

    return energyByDevice;
  }

  async calculateSavings(organizationId: number): Promise<SavingsResult> {
    const config = await this.getSavingsConfig(organizationId);
    const trucksWithLocations = await this.getTrucksWithLocations(organizationId);
    
    const trucksWithCoords = trucksWithLocations.filter(
      t => t.latitude !== null && t.longitude !== null && t.deviceId !== null
    );
    const usesRegionalPricing = trucksWithCoords.length > 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentFuelPrice = config.defaultFuelPrice;
    let todaySavings = 0;
    let todayWhSolar = 0;
    let todayGallonsSaved = 0;
    const truckBreakdown: TruckSavings[] = [];

    if (usesRegionalPricing && config.useLivePrices) {
      const energyByDevice = await this.getTodaySolarEnergyByDevice(organizationId);
      
      const regionPrices = new Map<PADDRegion, number>();
      let totalWeightedPrice = 0;
      let totalEnergy = 0;

      for (const truck of trucksWithCoords) {
        if (!truck.deviceId) continue;
        
        const solarWh = energyByDevice.get(truck.deviceId) || 0;
        if (solarWh === 0) continue;

        const paddInfo = getPADDFromCoordinates(truck.latitude!, truck.longitude!);
        const region = paddInfo.code;

        let fuelPrice = regionPrices.get(region);
        if (fuelPrice === undefined) {
          fuelPrice = await eiaClient.getCurrentFuelPrice(region);
          regionPrices.set(region, fuelPrice);
        }

        const solarKwh = solarWh / 1000;
        const gallonsSaved = solarKwh / config.dieselKwhPerGallon;
        const savings = gallonsSaved * fuelPrice;

        todayWhSolar += solarWh;
        todayGallonsSaved += gallonsSaved;
        todaySavings += savings;
        totalWeightedPrice += fuelPrice * solarWh;
        totalEnergy += solarWh;

        truckBreakdown.push({
          truckId: truck.truckId,
          truckNumber: truck.truckNumber,
          region,
          regionName: getPADDRegionName(region),
          fuelPrice,
          solarWh,
          gallonsSaved,
          savings,
        });
      }

      currentFuelPrice = totalEnergy > 0 
        ? totalWeightedPrice / totalEnergy 
        : await eiaClient.getCurrentFuelPrice("US");

    } else {
      if (config.useLivePrices) {
        currentFuelPrice = await eiaClient.getCurrentFuelPrice("US");
      }

      todayWhSolar = await this.getTodaySolarEnergy(organizationId);
      const todayKwh = todayWhSolar / 1000;
      todayGallonsSaved = todayKwh / config.dieselKwhPerGallon;
      todaySavings = todayGallonsSaved * currentFuelPrice;
    }

    const dailyBreakdown: DailySavings[] = [];
    let last7DaysTotal = 0;

    for (let i = 1; i <= 7; i++) {
      const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dayWh = await this.getDailySolarEnergy(organizationId, date);
      const dayPrice = await eiaClient.getPriceForDate(date, "US");
      
      const dayKwh = dayWh / 1000;
      const dayGallons = dayKwh / config.dieselKwhPerGallon;
      const daySavings = dayGallons * dayPrice;

      dailyBreakdown.push({
        date: date.toISOString().split('T')[0],
        totalWhSolar: dayWh,
        fuelSavedGallons: dayGallons,
        savings: daySavings,
        fuelPriceUsed: dayPrice,
      });

      last7DaysTotal += daySavings;
    }

    const last7DaysAverage = dailyBreakdown.length > 0 
      ? last7DaysTotal / dailyBreakdown.length 
      : 0;

    const trendDollarAmount = todaySavings - last7DaysAverage;
    const trendPercentage = last7DaysAverage > 0 
      ? Math.round((trendDollarAmount / last7DaysAverage) * 100) 
      : 0;
    const trendIsPositive = trendDollarAmount >= 0;

    return {
      todaySavings,
      todayWhSolar,
      todayGallonsSaved,
      last7DaysAverage,
      trendPercentage,
      trendIsPositive,
      trendDollarAmount,
      currentFuelPrice,
      dailyBreakdown,
      truckBreakdown: usesRegionalPricing ? truckBreakdown : undefined,
      usesRegionalPricing,
    };
  }

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
        })
        .from(trucks)
        .leftJoin(powerMonDevices, eq(powerMonDevices.truckId, trucks.id))
        .where(
          and(
            eq(trucks.organizationId, organizationId),
            eq(trucks.id, truckId)
          )
        );

      if (!truckData || !truckData.deviceId) {
        return null;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

      const [energyResult] = await db
        .select({
          maxEnergy: sql<number>`MAX(${deviceMeasurements.energy})`,
          minEnergy: sql<number>`MIN(${deviceMeasurements.energy})`,
        })
        .from(deviceMeasurements)
        .where(
          and(
            eq(deviceMeasurements.deviceId, truckData.deviceId),
            gte(deviceMeasurements.recordedAt, today),
            lte(deviceMeasurements.recordedAt, tomorrow)
          )
        );

      const solarWh = energyResult 
        ? Math.max(0, (energyResult.maxEnergy || 0) - (energyResult.minEnergy || 0))
        : 0;

      let region: PADDRegion = "US";
      let fuelPrice = config.defaultFuelPrice;

      if (truckData.latitude !== null && truckData.longitude !== null) {
        const paddInfo = getPADDFromCoordinates(truckData.latitude, truckData.longitude);
        region = paddInfo.code;
      }

      if (config.useLivePrices) {
        fuelPrice = await eiaClient.getCurrentFuelPrice(region);
      }

      const solarKwh = solarWh / 1000;
      const gallonsSaved = solarKwh / config.dieselKwhPerGallon;
      const savings = gallonsSaved * fuelPrice;

      return {
        truckId: truckData.truckId,
        truckNumber: truckData.truckNumber,
        region,
        regionName: getPADDRegionName(region),
        fuelPrice,
        solarWh,
        gallonsSaved,
        savings,
      };
    } catch (error) {
      console.error(`[SavingsCalculator] Failed to get savings for truck ${truckId}:`, error);
      return null;
    }
  }
}

export const savingsCalculator = new SavingsCalculator();
