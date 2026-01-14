-- Migration: Add pulse count tracking columns to shelly_devices
-- Date: 2026-01-14
-- Purpose: Enable frequency calculation from pulse count deltas
--
-- Run this SQL after connecting to the production database

-- Add pulse count tracking columns
ALTER TABLE shelly_devices 
ADD COLUMN IF NOT EXISTS last_pulse_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_pulse_count_at TIMESTAMP;

-- Verify columns were added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'shelly_devices' 
AND column_name IN ('last_pulse_count', 'last_pulse_count_at');
