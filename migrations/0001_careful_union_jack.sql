CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"device_id" integer,
	"truck_id" integer,
	"fleet_id" integer,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'warning',
	"title" text NOT NULL,
	"message" text,
	"threshold" real,
	"actual_value" real,
	"status" text DEFAULT 'active',
	"acknowledged_by" integer,
	"acknowledged_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"details" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"applied_at" timestamp DEFAULT now(),
	"applied_by" text DEFAULT 'system',
	CONSTRAINT "data_migrations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "device_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"connection_key" text NOT NULL,
	"access_key" text NOT NULL,
	"applink_url" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "device_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"truck_id" integer,
	"voltage1" real,
	"voltage2" real,
	"current" real,
	"power" real,
	"temperature" real,
	"soc" real,
	"energy" real,
	"charge" real,
	"runtime" integer,
	"rssi" integer,
	"power_status" integer,
	"power_status_string" text,
	"source" text DEFAULT 'poll',
	"recorded_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "device_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"truck_id" integer,
	"fleet_id" integer,
	"voltage1" real,
	"voltage2" real,
	"current" real,
	"power" real,
	"temperature" real,
	"soc" real,
	"energy" real,
	"charge" real,
	"runtime" integer,
	"rssi" integer,
	"power_status" integer,
	"power_status_string" text,
	"is_parked" boolean DEFAULT false,
	"parked_since" timestamp,
	"driving_since" timestamp,
	"today_parked_minutes" integer DEFAULT 0,
	"parked_date" text,
	"month_parked_minutes" integer DEFAULT 0,
	"parked_month" text,
	"recorded_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "device_statistics" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"truck_id" integer,
	"total_charge" real,
	"total_charge_energy" real,
	"total_discharge" real,
	"total_discharge_energy" real,
	"min_voltage" real,
	"max_voltage" real,
	"max_charge_current" real,
	"max_discharge_current" real,
	"time_since_last_full_charge" integer,
	"full_charge_capacity" real,
	"deepest_discharge" real,
	"last_discharge" real,
	"soc" real,
	"seconds_since_on" integer,
	"voltage1_min" real,
	"voltage1_max" real,
	"voltage2_min" real,
	"voltage2_max" real,
	"peak_charge_current" real,
	"peak_discharge_current" real,
	"temperature_min" real,
	"temperature_max" real,
	"recorded_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "device_sync_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"connection_status" text DEFAULT 'disconnected',
	"cohort_id" integer DEFAULT 0,
	"last_connected_at" timestamp,
	"last_disconnected_at" timestamp,
	"last_poll_at" timestamp,
	"last_successful_poll_at" timestamp,
	"consecutive_poll_failures" integer DEFAULT 0,
	"last_log_file_id" text,
	"last_log_offset" bigint DEFAULT 0,
	"last_log_sync_at" timestamp,
	"total_samples_synced" bigint DEFAULT 0,
	"backfill_status" text DEFAULT 'idle',
	"gap_start_at" timestamp,
	"gap_end_at" timestamp,
	"sync_status" text DEFAULT 'idle',
	"error_message" text,
	"consecutive_failures" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fleets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"timezone" text DEFAULT 'America/Los_Angeles',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fuel_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"price_date" timestamp NOT NULL,
	"price_per_gallon" real NOT NULL,
	"region" text DEFAULT 'US',
	"source" text DEFAULT 'EIA',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'standard',
	"is_active" boolean DEFAULT true,
	"settings" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "polling_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"polling_interval_seconds" integer DEFAULT 60,
	"log_sync_interval_minutes" integer DEFAULT 15,
	"offline_threshold_minutes" integer DEFAULT 5,
	"low_voltage_threshold" real DEFAULT 11.5,
	"is_enabled" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "power_mon_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"truck_id" integer,
	"serial_number" text NOT NULL,
	"device_name" text,
	"hardware_revision" text,
	"firmware_version" text,
	"host_id" text,
	"battery_voltage" real,
	"battery_ah" real,
	"number_of_batteries" integer,
	"status" text DEFAULT 'offline',
	"last_seen_at" timestamp,
	"assigned_at" timestamp,
	"unassigned_at" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "power_mon_devices_serial_number_unique" UNIQUE("serial_number")
);
--> statement-breakpoint
CREATE TABLE "savings_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"diesel_kwh_per_gallon" real DEFAULT 9,
	"default_fuel_price_per_gallon" real DEFAULT 3.5,
	"use_live_fuel_prices" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar(255) PRIMARY KEY NOT NULL,
	"sess" text NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_location_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"sim_id" integer NOT NULL,
	"truck_id" integer,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"accuracy" real,
	"source" text DEFAULT 'cell_tower',
	"recorded_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sim_sync_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"location_sync_interval_minutes" integer DEFAULT 5,
	"usage_sync_interval_minutes" integer DEFAULT 60,
	"data_usage_alert_threshold_percent" integer DEFAULT 80,
	"is_enabled" boolean DEFAULT true,
	"last_sim_sync_at" timestamp,
	"last_location_sync_at" timestamp,
	"last_usage_sync_at" timestamp,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sim_usage_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"sim_id" integer NOT NULL,
	"data_used_mb" real NOT NULL,
	"sms_count" integer DEFAULT 0,
	"period" text,
	"recorded_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sims" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"device_id" integer,
	"truck_id" integer,
	"simpro_id" integer,
	"iccid" text NOT NULL,
	"msisdn" text,
	"imsi" text,
	"eid" text,
	"device_name" text,
	"status" text DEFAULT 'unknown',
	"workflow_status" text,
	"ip_address" text,
	"latitude" real,
	"longitude" real,
	"location_accuracy" real,
	"last_location_update" timestamp,
	"data_used_mb" real DEFAULT 0,
	"data_limit_mb" real,
	"last_usage_update" timestamp,
	"last_sync_at" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sims_iccid_unique" UNIQUE("iccid")
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"fleet_id" integer NOT NULL,
	"truck_number" text NOT NULL,
	"driver_name" text,
	"make" text,
	"model" text,
	"year" integer,
	"vin_number" text,
	"license_plate" text,
	"status" text DEFAULT 'in-service',
	"latitude" real,
	"longitude" real,
	"last_location_update" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"first_name" text,
	"last_name" text,
	"profile_picture_url" text,
	"role" text DEFAULT 'user',
	"is_active" boolean DEFAULT true,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_power_mon_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."power_mon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_power_mon_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."power_mon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_measurements" ADD CONSTRAINT "device_measurements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_measurements" ADD CONSTRAINT "device_measurements_device_id_power_mon_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."power_mon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_measurements" ADD CONSTRAINT "device_measurements_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_snapshots" ADD CONSTRAINT "device_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_snapshots" ADD CONSTRAINT "device_snapshots_device_id_power_mon_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."power_mon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_snapshots" ADD CONSTRAINT "device_snapshots_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_snapshots" ADD CONSTRAINT "device_snapshots_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_statistics" ADD CONSTRAINT "device_statistics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_statistics" ADD CONSTRAINT "device_statistics_device_id_power_mon_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."power_mon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_statistics" ADD CONSTRAINT "device_statistics_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_status" ADD CONSTRAINT "device_sync_status_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_status" ADD CONSTRAINT "device_sync_status_device_id_power_mon_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."power_mon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_settings" ADD CONSTRAINT "polling_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_mon_devices" ADD CONSTRAINT "power_mon_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_mon_devices" ADD CONSTRAINT "power_mon_devices_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_config" ADD CONSTRAINT "savings_config_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_location_history" ADD CONSTRAINT "sim_location_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_location_history" ADD CONSTRAINT "sim_location_history_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_location_history" ADD CONSTRAINT "sim_location_history_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_sync_settings" ADD CONSTRAINT "sim_sync_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_usage_history" ADD CONSTRAINT "sim_usage_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_usage_history" ADD CONSTRAINT "sim_usage_history_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sims" ADD CONSTRAINT "sims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sims" ADD CONSTRAINT "sims_device_id_power_mon_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."power_mon_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sims" ADD CONSTRAINT "sims_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_org_idx" ON "alerts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "alert_org_status_idx" ON "alerts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "alert_device_idx" ON "alerts" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "alert_type_idx" ON "alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "alert_created_at_idx" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_migration_name_idx" ON "data_migrations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "credential_org_idx" ON "device_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_device_idx" ON "device_credentials" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "measurement_org_device_time_idx" ON "device_measurements" USING btree ("organization_id","device_id","recorded_at");--> statement-breakpoint
CREATE INDEX "measurement_recorded_at_idx" ON "device_measurements" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "measurement_device_time_idx" ON "device_measurements" USING btree ("device_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_device_idx" ON "device_snapshots" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "snapshot_org_idx" ON "device_snapshots" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "snapshot_org_fleet_idx" ON "device_snapshots" USING btree ("organization_id","fleet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statistics_device_idx" ON "device_statistics" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "statistics_org_idx" ON "device_statistics" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sync_status_org_idx" ON "device_sync_status" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_status_device_idx" ON "device_sync_status" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "sync_status_connection_idx" ON "device_sync_status" USING btree ("connection_status");--> statement-breakpoint
CREATE INDEX "sync_status_cohort_idx" ON "device_sync_status" USING btree ("cohort_id");--> statement-breakpoint
CREATE INDEX "fleet_org_idx" ON "fleets" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_org_name_idx" ON "fleets" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_price_date_region_idx" ON "fuel_prices" USING btree ("price_date","region");--> statement-breakpoint
CREATE INDEX "fuel_price_date_idx" ON "fuel_prices" USING btree ("price_date");--> statement-breakpoint
CREATE INDEX "org_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "password_reset_token_idx" ON "password_reset_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "password_reset_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_expires_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "polling_settings_org_idx" ON "polling_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "device_org_idx" ON "power_mon_devices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "device_truck_idx" ON "power_mon_devices" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "device_serial_idx" ON "power_mon_devices" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "device_status_idx" ON "power_mon_devices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_config_org_idx" ON "savings_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "session_expire_idx" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "sim_location_org_idx" ON "sim_location_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sim_location_sim_idx" ON "sim_location_history" USING btree ("sim_id");--> statement-breakpoint
CREATE INDEX "sim_location_time_idx" ON "sim_location_history" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "sim_location_sim_time_idx" ON "sim_location_history" USING btree ("sim_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_sync_settings_org_idx" ON "sim_sync_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sim_usage_org_idx" ON "sim_usage_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sim_usage_sim_idx" ON "sim_usage_history" USING btree ("sim_id");--> statement-breakpoint
CREATE INDEX "sim_usage_time_idx" ON "sim_usage_history" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "sim_org_idx" ON "sims" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sim_device_idx" ON "sims" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "sim_truck_idx" ON "sims" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "sim_iccid_idx" ON "sims" USING btree ("iccid");--> statement-breakpoint
CREATE INDEX "sim_msisdn_idx" ON "sims" USING btree ("msisdn");--> statement-breakpoint
CREATE INDEX "sim_device_name_idx" ON "sims" USING btree ("device_name");--> statement-breakpoint
CREATE INDEX "truck_org_idx" ON "trucks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "truck_fleet_idx" ON "trucks" USING btree ("fleet_id");--> statement-breakpoint
CREATE INDEX "truck_org_fleet_status_idx" ON "trucks" USING btree ("organization_id","fleet_id","status");--> statement-breakpoint
CREATE INDEX "truck_number_idx" ON "trucks" USING btree ("organization_id","truck_number");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_org_idx" ON "users" USING btree ("email","organization_id");--> statement-breakpoint
CREATE INDEX "user_org_idx" ON "users" USING btree ("organization_id");