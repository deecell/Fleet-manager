import { Pool, PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Enable SSL for AWS RDS or production environments
const isAWSRDS = connectionString.includes("rds.amazonaws.com");
const isProduction = process.env.NODE_ENV === "production";
const useSSL = isAWSRDS || isProduction;

// Remove sslmode from connection string - we'll handle SSL via pg library config
// This avoids conflicts between URL sslmode and pg ssl options
if (useSSL) {
  connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, "");
  // Clean up any trailing ? or && from removal
  connectionString = connectionString.replace(/\?$/, "").replace(/\?&/, "?").replace(/&&/, "&");
  console.log("[Database] Removed sslmode from URL, using pg ssl config instead");
}

console.log(`[Database] Connecting with SSL: ${useSSL}, isAWSRDS: ${isAWSRDS}, isProduction: ${isProduction}`);

const poolConfig: PoolConfig = {
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// For AWS RDS, enable SSL but skip certificate verification
if (useSSL) {
  poolConfig.ssl = {
    rejectUnauthorized: false,
  };
}

export const pool = new Pool(poolConfig);

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
