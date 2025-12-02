# Data Migrations

This directory contains data migrations that run during deployment.

## How It Works

1. **Schema migrations** are handled automatically by Drizzle (`npm run db:push`)
2. **Data migrations** are numbered TypeScript files that run in order

## Creating a New Data Migration

1. Create a file named `001_description.ts`, `002_description.ts`, etc.
2. Each migration should:
   - Check if it's already been applied (using `data_migrations` table)
   - Run the migration
   - Record itself in `data_migrations` table
   - Exit gracefully if already applied

## Template

```typescript
import { db } from "../../server/db";
import { dataMigrations } from "../../shared/schema";
import { sql, eq } from "drizzle-orm";

const MIGRATION_NAME = "001_my_migration_name";

async function run() {
  // Check if already applied
  const existing = await db.select().from(dataMigrations)
    .where(eq(dataMigrations.name, MIGRATION_NAME));
  
  if (existing.length > 0) {
    console.log(`Migration ${MIGRATION_NAME} already applied, skipping`);
    process.exit(0);
  }

  console.log(`Running migration: ${MIGRATION_NAME}`);

  // Your migration code here
  await db.execute(sql`...`);

  // Record migration
  await db.insert(dataMigrations).values({
    name: MIGRATION_NAME,
    description: "Description of what this migration does",
    appliedBy: "deployment"
  });

  console.log(`Migration ${MIGRATION_NAME} completed`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

## Running Locally

```bash
npx tsx migrations/data/001_example.ts
```

## During Deployment

The GitHub Actions workflow automatically runs all `*.ts` files in this directory in alphabetical order.
