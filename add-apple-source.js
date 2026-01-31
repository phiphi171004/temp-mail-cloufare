import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : false
});

async function addAppleSource() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Enabling Apple.edu.pl source...');
    
    // Enable Apple source
    const result = await client.query(`
      UPDATE admin_config 
      SET value = jsonb_set(value, '{enabledSources,apple}', 'true'::jsonb)
      WHERE key = 'main_config'
      RETURNING value->'enabledSources' as enabled_sources
    `);
    
    if (result.rowCount > 0) {
      console.log('✅ Apple source enabled successfully!');
      console.log('📋 Current enabled sources:', result.rows[0].enabled_sources);
    } else {
      console.log('⚠️  No rows updated. Config might not exist.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

addAppleSource();
