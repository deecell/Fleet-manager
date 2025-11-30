import { db } from "../db";
import { deviceMeasurements, deviceSnapshots } from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

interface FleetStatsResult {
  avgSoc: {
    value: number;
    trend7Day: number;
    trendPercentage: number;
    trendIsPositive: boolean;
  };
  tractorHoursOffset: {
    hours: number;
    minutes: number;
    trend7DayHours: number;
    trend7DayMinutes: number;
    trendPercentage: number;
    trendIsPositive: boolean;
  };
  maintenanceIntervalIncrease: {
    value: number;
    trend7Day: number;
    trendPercentage: number;
    trendIsPositive: boolean;
  };
}

const BASELINE_HOURS_PER_DEVICE_PER_DAY = 10;

export class FleetStatsCalculator {
  async get7DayAvgSoc(organizationId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    try {
      const result = await db
        .select({
          avgSoc: sql<number>`AVG(${deviceMeasurements.soc})`,
        })
        .from(deviceMeasurements)
        .where(
          and(
            eq(deviceMeasurements.organizationId, organizationId),
            gte(deviceMeasurements.recordedAt, sevenDaysAgo),
            lte(deviceMeasurements.recordedAt, today)
          )
        );

      return result[0]?.avgSoc || 0;
    } catch (error) {
      console.error("[FleetStats] Failed to get 7-day avg SOC:", error);
      return 0;
    }
  }

  async getCurrentAvgSocFromSnapshots(organizationId: number): Promise<number> {
    try {
      const result = await db
        .select({
          avgSoc: sql<number>`AVG(${deviceSnapshots.soc})`,
        })
        .from(deviceSnapshots)
        .where(eq(deviceSnapshots.organizationId, organizationId));

      return result[0]?.avgSoc || 0;
    } catch (error) {
      console.error("[FleetStats] Failed to get current avg SOC:", error);
      return 0;
    }
  }

  async getTodayRuntimeData(organizationId: number): Promise<{ totalHours: number; deviceCount: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    try {
      const result = await db
        .select({
          deviceId: deviceMeasurements.deviceId,
          maxRuntime: sql<number>`MAX(${deviceMeasurements.runtime})`,
          minRuntime: sql<number>`MIN(${deviceMeasurements.runtime})`,
        })
        .from(deviceMeasurements)
        .where(
          and(
            eq(deviceMeasurements.organizationId, organizationId),
            gte(deviceMeasurements.recordedAt, today),
            lte(deviceMeasurements.recordedAt, tomorrow)
          )
        )
        .groupBy(deviceMeasurements.deviceId);

      let totalRuntimeSeconds = 0;
      for (const row of result) {
        const maxRuntime = row.maxRuntime || 0;
        const minRuntime = row.minRuntime || 0;
        totalRuntimeSeconds += Math.max(0, maxRuntime - minRuntime);
      }

      return { 
        totalHours: totalRuntimeSeconds / 3600, 
        deviceCount: result.length 
      };
    } catch (error) {
      console.error("[FleetStats] Failed to get today's runtime:", error);
      return { totalHours: 0, deviceCount: 0 };
    }
  }

  async get7DayAvgRuntimeData(organizationId: number): Promise<{ avgDailyTotalHours: number; avgDeviceCount: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let totalRuntime = 0;
    let totalDeviceCount = 0;
    let daysWithData = 0;

    for (let i = 1; i <= 7; i++) {
      const dayStart = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      try {
        const result = await db
          .select({
            deviceId: deviceMeasurements.deviceId,
            maxRuntime: sql<number>`MAX(${deviceMeasurements.runtime})`,
            minRuntime: sql<number>`MIN(${deviceMeasurements.runtime})`,
          })
          .from(deviceMeasurements)
          .where(
            and(
              eq(deviceMeasurements.organizationId, organizationId),
              gte(deviceMeasurements.recordedAt, dayStart),
              lte(deviceMeasurements.recordedAt, dayEnd)
            )
          )
          .groupBy(deviceMeasurements.deviceId);

        if (result.length > 0) {
          let dayRuntime = 0;
          for (const row of result) {
            const maxRuntime = row.maxRuntime || 0;
            const minRuntime = row.minRuntime || 0;
            dayRuntime += Math.max(0, maxRuntime - minRuntime);
          }
          totalRuntime += dayRuntime / 3600;
          totalDeviceCount += result.length;
          daysWithData++;
        }
      } catch (error) {
        console.error(`[FleetStats] Failed to get runtime for day ${i}:`, error);
      }
    }

    return { 
      avgDailyTotalHours: daysWithData > 0 ? totalRuntime / daysWithData : 0,
      avgDeviceCount: daysWithData > 0 ? totalDeviceCount / daysWithData : 0
    };
  }

  async calculateFleetStats(organizationId: number): Promise<FleetStatsResult> {
    const currentAvgSoc = await this.getCurrentAvgSocFromSnapshots(organizationId);
    const sevenDayAvgSoc = await this.get7DayAvgSoc(organizationId);
    
    const socDiff = currentAvgSoc - sevenDayAvgSoc;
    const socTrendPercentage = sevenDayAvgSoc > 0 
      ? Math.round((socDiff / sevenDayAvgSoc) * 100) 
      : 0;

    const todayData = await this.getTodayRuntimeData(organizationId);
    const sevenDayData = await this.get7DayAvgRuntimeData(organizationId);

    const deviceCountToday = todayData.deviceCount > 0 ? todayData.deviceCount : 1;
    const deviceCount7Day = sevenDayData.avgDeviceCount > 0 ? sevenDayData.avgDeviceCount : 1;

    const todayFleetBaseline = BASELINE_HOURS_PER_DEVICE_PER_DAY * deviceCountToday;
    const todayHoursOffset = todayFleetBaseline - todayData.totalHours;

    const sevenDayFleetBaseline = BASELINE_HOURS_PER_DEVICE_PER_DAY * deviceCount7Day;
    const sevenDayHoursOffset = sevenDayFleetBaseline - sevenDayData.avgDailyTotalHours;

    const hoursOffsetClamped = Math.max(0, todayHoursOffset);
    const hoursOffsetWhole = Math.floor(hoursOffsetClamped);
    const minutesOffset = Math.round((hoursOffsetClamped - hoursOffsetWhole) * 60);

    const sevenDayOffsetClamped = Math.max(0, sevenDayHoursOffset);
    const sevenDayHoursWhole = Math.floor(sevenDayOffsetClamped);
    const sevenDayMinutesOffset = Math.round((sevenDayOffsetClamped - sevenDayHoursWhole) * 60);

    const offsetDiff = hoursOffsetClamped - sevenDayOffsetClamped;
    const offsetTrendPercentage = sevenDayOffsetClamped > 0 
      ? Math.round((offsetDiff / sevenDayOffsetClamped) * 100) 
      : 0;

    const todayDailyHoursSavedPerDevice = deviceCountToday > 0 
      ? hoursOffsetClamped / deviceCountToday 
      : 0;
    const sevenDayDailyHoursSavedPerDevice = deviceCount7Day > 0 
      ? sevenDayOffsetClamped / deviceCount7Day 
      : 0;

    const todayMaintenanceIncrease = todayDailyHoursSavedPerDevice > 0
      ? Math.round((todayDailyHoursSavedPerDevice / BASELINE_HOURS_PER_DEVICE_PER_DAY) * 100)
      : 0;
    const sevenDayMaintenanceIncrease = sevenDayDailyHoursSavedPerDevice > 0
      ? Math.round((sevenDayDailyHoursSavedPerDevice / BASELINE_HOURS_PER_DEVICE_PER_DAY) * 100)
      : 0;
    
    const maintenanceDiff = todayMaintenanceIncrease - sevenDayMaintenanceIncrease;
    const maintenanceTrendPercentage = sevenDayMaintenanceIncrease > 0 
      ? Math.round((maintenanceDiff / sevenDayMaintenanceIncrease) * 100) 
      : 0;

    return {
      avgSoc: {
        value: Math.round(currentAvgSoc),
        trend7Day: Math.round(sevenDayAvgSoc),
        trendPercentage: Math.abs(socTrendPercentage),
        trendIsPositive: socDiff >= 0,
      },
      tractorHoursOffset: {
        hours: hoursOffsetWhole,
        minutes: minutesOffset,
        trend7DayHours: sevenDayHoursWhole,
        trend7DayMinutes: sevenDayMinutesOffset,
        trendPercentage: Math.abs(offsetTrendPercentage),
        trendIsPositive: offsetDiff >= 0,
      },
      maintenanceIntervalIncrease: {
        value: todayMaintenanceIncrease,
        trend7Day: sevenDayMaintenanceIncrease,
        trendPercentage: Math.abs(maintenanceTrendPercentage),
        trendIsPositive: maintenanceDiff >= 0,
      },
    };
  }
}

export const fleetStatsCalculator = new FleetStatsCalculator();
