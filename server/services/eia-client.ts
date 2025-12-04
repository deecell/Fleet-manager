import { db } from "../db";
import { fuelPrices } from "@shared/schema";
import { desc, eq, and, gte, lte } from "drizzle-orm";
import { PADDRegion, getEIACodeForPADD, getPADDRegionName, getAllPADDCodes } from "./padd-regions";

const EIA_API_BASE = "https://api.eia.gov/v2/petroleum/pri/gnd/data/";
const DEFAULT_FUEL_PRICE = 3.50;

interface EIAResponse {
  response: {
    data: Array<{
      period: string;
      value: string | number; // EIA returns value as string
      "area-name": string;
      "product-name": string;
      duoarea: string;
    }>;
  };
}

export class EIAClient {
  private apiKey: string | null;

  constructor() {
    this.apiKey = process.env.EIA_API_KEY || null;
  }

  async fetchLatestDieselPrice(region: PADDRegion = "US"): Promise<number | null> {
    if (!this.apiKey) {
      console.log("[EIA] No API key configured, using cached or default price");
      return null;
    }

    try {
      const eiaCode = getEIACodeForPADD(region);
      const url = new URL(EIA_API_BASE);
      url.searchParams.set("api_key", this.apiKey);
      url.searchParams.set("frequency", "weekly");
      url.searchParams.set("data[]", "value");
      url.searchParams.set("facets[product][]", "EPD2D");
      url.searchParams.set("facets[duoarea][]", eiaCode);
      url.searchParams.set("sort[0][column]", "period");
      url.searchParams.set("sort[0][direction]", "desc");
      url.searchParams.set("length", "1");

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        console.error(`[EIA] API request failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const data: EIAResponse = await response.json();
      
      if (data.response?.data?.length > 0) {
        // EIA returns value as string, parse to float
        const rawValue = data.response.data[0].value;
        const latestPrice = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
        const priceDate = new Date(data.response.data[0].period);
        
        await this.storeFuelPrice(priceDate, latestPrice, region);
        
        const regionName = getPADDRegionName(region);
        console.log(`[EIA] Fetched ${regionName} diesel price: $${latestPrice}/gallon for ${data.response.data[0].period}`);
        return latestPrice;
      }

      return null;
    } catch (error) {
      console.error(`[EIA] Failed to fetch diesel price for ${region}:`, error);
      return null;
    }
  }

  async fetchAllRegionalPrices(): Promise<Map<PADDRegion, number>> {
    const prices = new Map<PADDRegion, number>();
    
    const usPrice = await this.fetchLatestDieselPrice("US");
    if (usPrice !== null) {
      prices.set("US", usPrice);
    }

    const regions = getAllPADDCodes();
    for (const region of regions) {
      const price = await this.fetchLatestDieselPrice(region);
      if (price !== null) {
        prices.set(region, price);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return prices;
  }

  private async storeFuelPrice(priceDate: Date, price: number, region: PADDRegion = "US"): Promise<void> {
    try {
      const startOfDay = new Date(priceDate);
      startOfDay.setHours(0, 0, 0, 0);

      const existing = await db
        .select()
        .from(fuelPrices)
        .where(
          and(
            gte(fuelPrices.priceDate, startOfDay),
            lte(fuelPrices.priceDate, new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)),
            eq(fuelPrices.region, region)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(fuelPrices).values({
          priceDate: startOfDay,
          pricePerGallon: price,
          region: region,
          source: "EIA",
        });
        console.log(`[EIA] Stored new fuel price: $${price} for ${region} on ${startOfDay.toISOString().split('T')[0]}`);
      }
    } catch (error) {
      console.error(`[EIA] Failed to store fuel price for ${region}:`, error);
    }
  }

  async getLatestStoredPrice(region: PADDRegion = "US"): Promise<number> {
    try {
      const [latest] = await db
        .select()
        .from(fuelPrices)
        .where(eq(fuelPrices.region, region))
        .orderBy(desc(fuelPrices.priceDate))
        .limit(1);

      if (latest) {
        return latest.pricePerGallon;
      }

      if (region !== "US") {
        return this.getLatestStoredPrice("US");
      }
    } catch (error) {
      console.error(`[EIA] Failed to get stored price for ${region}:`, error);
    }

    return DEFAULT_FUEL_PRICE;
  }

  async getCurrentFuelPrice(region: PADDRegion = "US"): Promise<number> {
    const livePrice = await this.fetchLatestDieselPrice(region);
    if (livePrice !== null) {
      return livePrice;
    }

    return this.getLatestStoredPrice(region);
  }

  async getPriceForDate(date: Date, region: PADDRegion = "US"): Promise<number> {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const [price] = await db
        .select()
        .from(fuelPrices)
        .where(
          and(
            gte(fuelPrices.priceDate, startOfDay),
            lte(fuelPrices.priceDate, endOfDay),
            eq(fuelPrices.region, region)
          )
        )
        .limit(1);

      if (price) {
        return price.pricePerGallon;
      }

      const [closestBefore] = await db
        .select()
        .from(fuelPrices)
        .where(
          and(
            lte(fuelPrices.priceDate, startOfDay),
            eq(fuelPrices.region, region)
          )
        )
        .orderBy(desc(fuelPrices.priceDate))
        .limit(1);

      if (closestBefore) {
        return closestBefore.pricePerGallon;
      }

      if (region !== "US") {
        return this.getPriceForDate(date, "US");
      }
    } catch (error) {
      console.error(`[EIA] Failed to get price for date ${date} and region ${region}:`, error);
    }

    return DEFAULT_FUEL_PRICE;
  }

  async getRegionalPriceComparison(): Promise<Array<{ region: PADDRegion; name: string; price: number }>> {
    const comparison: Array<{ region: PADDRegion; name: string; price: number }> = [];
    
    const usPrice = await this.getCurrentFuelPrice("US");
    comparison.push({ region: "US", name: "U.S. National Average", price: usPrice });

    for (const region of getAllPADDCodes()) {
      const price = await this.getLatestStoredPrice(region);
      comparison.push({
        region,
        name: getPADDRegionName(region),
        price,
      });
    }

    return comparison.sort((a, b) => a.price - b.price);
  }
}

export const eiaClient = new EIAClient();
