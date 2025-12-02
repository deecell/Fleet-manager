import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Enable SSL for AWS RDS or production environments
const isAWSRDS = connectionString.includes("rds.amazonaws.com");
const isProduction = process.env.NODE_ENV === "production";
const useSSL = isAWSRDS || isProduction;

console.log(`[Database] Connecting with SSL: ${useSSL}`);

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });

export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}
