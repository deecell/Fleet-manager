import { db } from "../db";
import { fuelPrices } from "@shared/schema";
import { desc, eq, and, gte, lte } from "drizzle-orm";

const EIA_API_BASE = "https://api.eia.gov/v2/petroleum/pri/gnd/data/";
const DEFAULT_FUEL_PRICE = 3.50;

interface EIAResponse {
  response: {
    data: Array<{
      period: string;
      value: number;
      "area-name": string;
      "product-name": string;
    }>;
  };
}

export class EIAClient {
  private apiKey: string | null;

  constructor() {
    this.apiKey = process.env.EIA_API_KEY || null;
  }

  async fetchLatestDieselPrice(): Promise<number | null> {
    if (!this.apiKey) {
      console.log("[EIA] No API key configured, using cached or default price");
      return null;
    }

    try {
      const url = new URL(EIA_API_BASE);
      url.searchParams.set("api_key", this.apiKey);
      url.searchParams.set("frequency", "weekly");
      url.searchParams.set("data[]", "value");
      url.searchParams.set("facets[product][]", "EPD2D");
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
        const latestPrice = data.response.data[0].value;
        const priceDate = new Date(data.response.data[0].period);
        
        await this.storeFuelPrice(priceDate, latestPrice);
        
        console.log(`[EIA] Fetched diesel price: $${latestPrice}/gallon for ${data.response.data[0].period}`);
        return latestPrice;
      }

      return null;
    } catch (error) {
      console.error("[EIA] Failed to fetch diesel price:", error);
      return null;
    }
  }

  private async storeFuelPrice(priceDate: Date, price: number): Promise<void> {
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
            eq(fuelPrices.region, "US")
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(fuelPrices).values({
          priceDate: startOfDay,
          pricePerGallon: price,
          region: "US",
          source: "EIA",
        });
        console.log(`[EIA] Stored new fuel price: $${price} for ${startOfDay.toISOString().split('T')[0]}`);
      }
    } catch (error) {
      console.error("[EIA] Failed to store fuel price:", error);
    }
  }

  async getLatestStoredPrice(): Promise<number> {
    try {
      const [latest] = await db
        .select()
        .from(fuelPrices)
        .where(eq(fuelPrices.region, "US"))
        .orderBy(desc(fuelPrices.priceDate))
        .limit(1);

      if (latest) {
        return latest.pricePerGallon;
      }
    } catch (error) {
      console.error("[EIA] Failed to get stored price:", error);
    }

    return DEFAULT_FUEL_PRICE;
  }

  async getCurrentFuelPrice(): Promise<number> {
    const livePrice = await this.fetchLatestDieselPrice();
    if (livePrice !== null) {
      return livePrice;
    }

    return this.getLatestStoredPrice();
  }

  async getPriceForDate(date: Date): Promise<number> {
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
            eq(fuelPrices.region, "US")
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
            eq(fuelPrices.region, "US")
          )
        )
        .orderBy(desc(fuelPrices.priceDate))
        .limit(1);

      if (closestBefore) {
        return closestBefore.pricePerGallon;
      }
    } catch (error) {
      console.error("[EIA] Failed to get price for date:", error);
    }

    return DEFAULT_FUEL_PRICE;
  }
}

export const eiaClient = new EIAClient();
