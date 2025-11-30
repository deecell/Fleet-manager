import { db } from "../db";
import { deviceMeasurements, savingsConfig } from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { eiaClient } from "./eia-client";

const DEFAULT_DIESEL_KWH_PER_GALLON = 9.0;

interface DailySavings {
  date: string;
  totalWhSolar: number;
  fuelSavedGallons: number;
  savings: number;
  fuelPriceUsed: number;
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

  async getTodaySolarEnergy(organizationId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    return this.getSolarEnergyForPeriod(organizationId, today, tomorrow);
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

  async calculateSavings(organizationId: number): Promise<SavingsResult> {
    const config = await this.getSavingsConfig(organizationId);
    
    let currentFuelPrice = config.defaultFuelPrice;
    if (config.useLivePrices) {
      currentFuelPrice = await eiaClient.getCurrentFuelPrice();
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayWhSolar = await this.getTodaySolarEnergy(organizationId);
    
    const todayKwh = todayWhSolar / 1000;
    const todayGallonsSaved = todayKwh / config.dieselKwhPerGallon;
    const todaySavings = todayGallonsSaved * currentFuelPrice;

    const dailyBreakdown: DailySavings[] = [];
    let last7DaysTotal = 0;

    for (let i = 1; i <= 7; i++) {
      const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dayWh = await this.getDailySolarEnergy(organizationId, date);
      const dayPrice = await eiaClient.getPriceForDate(date);
      
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
    };
  }
}

export const savingsCalculator = new SavingsCalculator();
