import { Pool, PoolClient } from "pg";

const pool = new Pool({
  host: process.env.RDS_HOST || "deecell-fleet-db.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com",
  port: parseInt(process.env.RDS_PORT || "5432"),
  database: process.env.RDS_DATABASE || "fleet_db",
  user: process.env.RDS_USERNAME || "postgres",
  password: process.env.RDS_PASSWORD || "",
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function getClient(): Promise<PoolClient> {
  return await pool.connect();
}

export async function testConnection(): Promise<boolean> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("SELECT NOW()");
    console.log("RDS PostgreSQL connection successful");
    return true;
  } catch (error) {
    console.error("RDS PostgreSQL connection failed:", error);
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function initializeTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS trucks (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'not-in-service',
        location VARCHAR(200),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        soc DECIMAL(5, 2) DEFAULT 0,
        v1 DECIMAL(10, 2) DEFAULT 0,
        v2 DECIMAL(10, 2) DEFAULT 0,
        i1 DECIMAL(10, 2) DEFAULT 0,
        i2 DECIMAL(10, 2) DEFAULT 0,
        w1 DECIMAL(10, 2) DEFAULT 0,
        w2 DECIMAL(10, 2) DEFAULT 0,
        temp1 DECIMAL(5, 2) DEFAULT 0,
        temp2 DECIMAL(5, 2) DEFAULT 0,
        model VARCHAR(100),
        serial VARCHAR(100),
        fw VARCHAR(50),
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS truck_history (
        id SERIAL PRIMARY KEY,
        truck_id VARCHAR(50) REFERENCES trucks(id),
        timestamp TIMESTAMP NOT NULL,
        soc DECIMAL(5, 2),
        voltage DECIMAL(10, 2),
        current DECIMAL(10, 2),
        watts DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(50) PRIMARY KEY,
        truck_id VARCHAR(50) REFERENCES trucks(id),
        type VARCHAR(20) NOT NULL,
        title VARCHAR(200) NOT NULL,
        message TEXT,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        truck_id VARCHAR(50) REFERENCES trucks(id),
        file_key VARCHAR(500) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(100),
        file_size INTEGER,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database tables initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database tables:", error);
    throw error;
  } finally {
    client.release();
  }
}

export { pool };
