const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 
  'postgresql://deecell_admin:yDuUAs2pv4y12kS3@deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432/deecell_fleet';

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    
    // Add missing name column to users if it doesn't exist
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
    `);
    console.log('Added name column to users');

    // Create admin user (password: admin123)
    const passwordHash = '$2a$10$gKzBYjdP5vF8h0TKzGrJ.eYL.6h1Wd2i/VZrb5aXz0YWXmM9nQXXq';
    await client.query(`
      INSERT INTO users (organization_id, email, password_hash, name, role)
      SELECT 1, 'admin@deecell.com', $1, 'Admin User', 'admin'
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@deecell.com')
    `, [passwordHash]);
    console.log('Admin user created');

    console.log('Migration complete!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
