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

// For AWS RDS, replace sslmode=require with sslmode=no-verify to avoid certificate issues
if (useSSL && connectionString.includes("sslmode=require")) {
  connectionString = connectionString.replace("sslmode=require", "sslmode=no-verify");
  console.log("[Database] Updated sslmode to no-verify for AWS RDS");
}

console.log(`[Database] Connecting with SSL: ${useSSL}, isAWSRDS: ${isAWSRDS}, isProduction: ${isProduction}`);

const poolConfig: PoolConfig = {
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// For AWS RDS, we need to explicitly disable certificate verification
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
