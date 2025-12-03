-- Add parked status tracking columns to device_snapshots
-- These columns track when trucks are parked (engine off) for fuel savings calculation

ALTER TABLE "device_snapshots" ADD COLUMN IF NOT EXISTS "is_parked" boolean DEFAULT false;
ALTER TABLE "device_snapshots" ADD COLUMN IF NOT EXISTS "parked_since" timestamp;
ALTER TABLE "device_snapshots" ADD COLUMN IF NOT EXISTS "today_parked_minutes" integer DEFAULT 0;
ALTER TABLE "device_snapshots" ADD COLUMN IF NOT EXISTS "parked_date" text;
