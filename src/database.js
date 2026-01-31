import pkg from 'pg';
const { Pool } = pkg;

let pool = null;

// Initialize database connection
export function initDatabase() {
    const DATABASE_URL = process.env.DATABASE_URL;

    if (!DATABASE_URL) {
        console.log('[Database] DATABASE_URL not set, using file-based storage');
        return null;
    }

    try {
        pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });

        console.log('[Database] PostgreSQL connection pool initialized');
        return pool;
    } catch (error) {
        console.error('[Database] Failed to initialize:', error.message);
        return null;
    }
}

// Create admin_config table if not exists
export async function createAdminConfigTable() {
    if (!pool) return;

    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_config (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
        console.log('[Database] admin_config table ready');
    } catch (error) {
        console.error('[Database] Failed to create table:', error.message);
    }
}

// Get admin config from database
export async function getAdminConfigFromDB() {
    if (!pool) return null;

    try {
        const result = await pool.query(
            'SELECT value FROM admin_config WHERE key = $1',
            ['main_config']
        );

        if (result.rows.length > 0) {
            return result.rows[0].value;
        }

        // If no config exists, create default
        const defaultConfig = {
            defaultSource: 'noopmail',
            enabledSources: {
                tmail: true,
                noopmail: true,
                temporarymail: true,
                mailio: true,
                pmail: true,
                etempmail: true,
                tinyhost: true,
                edumail: true
            },
            adminPassword: 'admin123'
        };

        await pool.query(
            `INSERT INTO admin_config (key, value) 
       VALUES ($1, $2) 
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
            ['main_config', JSON.stringify(defaultConfig)]
        );

        return defaultConfig;
    } catch (error) {
        console.error('[Database] Failed to get config:', error.message);
        return null;
    }
}

// Save admin config to database
export async function saveAdminConfigToDB(config) {
    if (!pool) return false;

    try {
        await pool.query(
            `INSERT INTO admin_config (key, value) 
       VALUES ($1, $2) 
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
            ['main_config', JSON.stringify(config)]
        );
        return true;
    } catch (error) {
        console.error('[Database] Failed to save config:', error.message);
        return false;
    }
}

// Check if database is available
export function isDatabaseAvailable() {
    return pool !== null;
}
