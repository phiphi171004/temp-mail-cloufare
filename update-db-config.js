import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

/**
 * Script để update admin config trong Supabase
 * Thêm edumail vào enabledSources
 */
async function updateConfig() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL không được set trong .env');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 Đang kết nối database...');
    
    // Lấy config hiện tại
    const result = await pool.query(
      'SELECT value FROM admin_config WHERE key = $1',
      ['main_config']
    );

    if (result.rows.length === 0) {
      console.log('⚠️  Chưa có config trong database, sẽ tạo mới khi server chạy');
      await pool.end();
      return;
    }

    const currentConfig = result.rows[0].value;
    console.log('📋 Config hiện tại:', JSON.stringify(currentConfig, null, 2));

    // Thêm edumail vào enabledSources nếu chưa có
    if (!currentConfig.enabledSources.edumail) {
      currentConfig.enabledSources.edumail = true;
      
      // Update database
      await pool.query(
        `UPDATE admin_config 
         SET value = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE key = $2`,
        [JSON.stringify(currentConfig), 'main_config']
      );

      console.log('✅ Đã thêm edumail vào enabledSources');
      console.log('📋 Config mới:', JSON.stringify(currentConfig, null, 2));
    } else {
      console.log('ℹ️  edumail đã có trong config');
    }

    await pool.end();
    console.log('✅ Hoàn tất!');
  } catch (error) {
    console.error('❌ Lỗi:', error.message);
    await pool.end();
    process.exit(1);
  }
}

updateConfig();
