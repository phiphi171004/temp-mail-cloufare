// Load environment variables từ .env file (phải load trước khi import CONFIG)
import 'dotenv/config';

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { TempMail } from './tempmail.js';
import { CONFIG } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Track server start time for uptime
const serverStartTime = Date.now();

// Middleware
app.use(express.json());

// CORS middleware - cho phép request từ các origin khác
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Session-ID');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store temp mail instances per session (simplified, use Redis in production)
const sessions = new Map();

/**
 * Get or create TempMail instance for session
 */
function getTempMail(sessionId) {
  if (!sessions.has(sessionId)) {
    const tempMail = new TempMail();
    sessions.set(sessionId, tempMail);
  }
  return sessions.get(sessionId);
}

// Routes

/**
 * GET /api/domains - Lấy danh sách domains
 */
app.get('/api/domains', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  
  res.json({
    success: true,
    domains: tempMail.getDomains(),
    source: tempMail.getCurrentSourceInfo()
  });
});

/**
 * GET /api/sources - Lấy danh sách tất cả nguồn mail
 */
app.get('/api/sources', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  
  res.json({
    success: true,
    sources: tempMail.getAllSources(),
    current: tempMail.getCurrentSourceInfo()
  });
});

/**
 * POST /api/source/switch - Chuyển đổi nguồn mail
 */
app.post('/api/source/switch', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const { sourceId } = req.body;
  const tempMail = getTempMail(sessionId);
  
  if (!sourceId) {
    return res.status(400).json({
      success: false,
      error: 'sourceId is required'
    });
  }

  try {
    await tempMail.switchSource(sourceId);
    res.json({
      success: true,
      message: `Đã chuyển sang nguồn: ${sourceId}`,
      source: tempMail.getCurrentSourceInfo()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/init - Khởi tạo session
 */
app.post('/api/init', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const { sourceId } = req.body; // Cho phép chọn nguồn mail
  const tempMail = getTempMail(sessionId);
  
  try {
    await tempMail.init(sourceId || 'tmail');
    res.json({
      success: true,
      message: 'Session initialized',
      source: tempMail.getCurrentSourceInfo()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email/create - Tạo email mới
 */
app.post('/api/email/create', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const { username, domain } = req.body;
  const currentSource = tempMail.getCurrentSourceInfo()?.id || 'tmail';

  // Debug: Log session info
  console.log(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/create - Username: ${username || 'null'}, Domain: ${domain || 'null'}, Source: ${currentSource}`);

  // TempMail ID không bắt buộc username (có thể null để random)
  if (currentSource !== 'tempmail-id' && !username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required'
    });
  }

  try {
    // TempMail ID: có thể truyền null cho username để random
    const finalUsername = (currentSource === 'tempmail-id') ? (username || null) : username;
    const result = await tempMail.createEmail(finalUsername, domain);
    console.log(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/create - Result: ${result.success ? 'success' : 'failed'}, Email: ${result.email || 'null'}`);
    res.json(result);
  } catch (error) {
    console.error(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/create - Error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email/random - Tạo email ngẫu nhiên
 */
app.post('/api/email/random', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);

  // Debug: Log session info
  console.log(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/random`);

  try {
    const result = await tempMail.createRandomEmail();
    console.log(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/random - Result: ${result.success ? 'success' : 'failed'}, Email: ${result.email || 'null'}`);
    res.json(result);
  } catch (error) {
    console.error(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/random - Error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email/sync - Sync email (dùng khi reload)
 */
app.post('/api/email/sync', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const { email } = req.body;

  // Debug: Log session info
  console.log(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/sync - Email: ${email || 'null'}`);

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email is required'
    });
  }

  try {
    // QUAN TRỌNG: Đảm bảo client đã được init trước khi sync
    // Vì khi reload, session mới được tạo nhưng client chưa init
    const sourceId = tempMail.getCurrentSourceInfo()?.id || 'tmail';
    if (!tempMail.client) {
      console.log(`[SESSION ${sessionId.substring(0, 8)}] Client chưa init, đang init với source: ${sourceId}`);
      await tempMail.init(sourceId);
    }
    
    // QUAN TRỌNG: Set email vào tempMail.currentEmail trước khi sync
    // Để fetchMessages() có thể tìm thấy email
    tempMail.currentEmail = email;
    
    await tempMail.syncEmailOnReload();
    console.log(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/sync - Success: Email synced`);
    res.json({
      success: true,
      message: 'Email synced successfully'
    });
  } catch (error) {
    console.error(`[SESSION ${sessionId.substring(0, 8)}] POST /api/email/sync - Error:`, error.message);
    // Không trả về 500, mà trả về success: false để frontend có thể xử lý (tạo email mới)
    res.json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/messages - Lấy danh sách thư
 */
app.get('/api/messages', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const sourceId = tempMail.getCurrentSourceInfo()?.id || 'unknown';
  const currentEmail = tempMail.getCurrentEmail();

  // Debug: Log session info để track vấn đề
  console.log(`[SESSION ${sessionId.substring(0, 8)}] GET /api/messages - Email: ${currentEmail || 'null'}, Source: ${sourceId}`);

  try {
    const result = await tempMail.fetchMessages();
    console.log(`[SESSION ${sessionId.substring(0, 8)}] GET /api/messages - Result: ${result.success ? 'success' : 'failed'}, Messages: ${result.count || 0}`);
    res.json(result);
  } catch (error) {
    console.error(`[SESSION ${sessionId.substring(0, 8)}] GET /api/messages - Exception:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/message/:messageId - Lấy chi tiết message (body đầy đủ)
 */
app.get('/api/message/:messageId', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const { messageId } = req.params;

  console.log(`[SESSION ${sessionId.substring(0, 8)}] GET /api/message/${messageId} - Source: ${tempMail.sourceId}`);

  try {
    const result = await tempMail.getMessageDetail(messageId);
    
    // Format response để frontend dễ xử lý
    if (result.success) {
      res.json({
        success: true,
        message: {
          content: result.content || result.content_raw || '',
          content_raw: result.content_raw || result.content || '',
          html: result.html || null,
          text: result.text || null,
          subject: result.subject || '',
          from: result.from || '',
          to: result.to || '',
          date: result.date || null,
          hasAttm: result.hasAttm || 0
        }
      });
    } else {
      res.json(result);
    }
  } catch (error) {
    console.error(`[SESSION ${sessionId.substring(0, 8)}] GET /api/message/${messageId} - Exception:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/polling/start - Bắt đầu polling để check mail mới (chỉ cho iMail)
 */
app.post('/api/polling/start', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const { interval = 3000 } = req.body;

  try {
    tempMail.startPolling(interval, (result) => {
      // Callback được gọi mỗi khi có kết quả fetchMessages
      // Có thể dùng WebSocket hoặc Server-Sent Events để push về client
      // Hiện tại chỉ log
      if (result.success && result.messages && result.messages.length > 0) {
        console.log(`📧 Có ${result.messages.length} mail mới`);
      }
    });
    
    res.json({
      success: true,
      message: 'Polling đã được bắt đầu'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/polling/stop - Dừng polling
 */
app.post('/api/polling/stop', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);

  try {
    tempMail.stopPolling();
    res.json({
      success: true,
      message: 'Polling đã được dừng'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/email/current - Lấy email hiện tại
 */
app.get('/api/email/current', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);

  res.json({
    success: true,
    email: tempMail.getCurrentEmail(),
    emails: tempMail.getAllEmails()
  });
});

/**
 * DELETE /api/email - Xóa email hiện tại
 */
app.delete('/api/email', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);

  try {
    const result = await tempMail.deleteEmail();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/domain - Đổi domain
 */
app.post('/api/domain', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const { domain } = req.body;

  if (!domain) {
    return res.status(400).json({
      success: false,
      error: 'Domain is required'
    });
  }

  try {
    const result = await tempMail.setDomain(domain);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/stats - Lấy thống kê proxy
 */
app.get('/api/stats', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  
  if (!CONFIG.USE_PROXY) {
    return res.json({
      success: true,
      proxyEnabled: false,
      stats: null,
      message: 'Direct mode (no proxy)'
    });
  }

  const stats = tempMail.client.getProxyStats();
  
  res.json({
    success: true,
    proxyEnabled: true,
    stats: stats,
    message: 'ScraperAPI is enabled'
  });
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  const uptime = (Date.now() - serverStartTime) / 1000; // seconds
  
  const health = {
    status: 'ok',
    mode: CONFIG.USE_PROXY ? 'proxy' : 'direct',
    uptime: uptime,
    timestamp: new Date().toISOString()
  };

  // Thêm stats nếu dùng proxy
  if (CONFIG.USE_PROXY) {
    const sessionId = 'default';
    if (sessions.has(sessionId)) {
      const tempMail = sessions.get(sessionId);
      const stats = tempMail.client.getProxyStats();
      if (stats) {
        health.stats = {
          totalRequests: stats.totalRequests,
          successRate: stats.successRate,
          averageResponseTime: stats.averageResponseTime
        };
      }
    }
  }

  res.json(health);
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  const proxyMode = CONFIG.USE_PROXY ? '🔄 PROXY (ScraperAPI)' : '⚡ DIRECT';
  const proxyStatus = CONFIG.USE_PROXY 
    ? `║     ✓ ScraperAPI: ENABLED                 ║`
    : `║     ⚠ Proxy: DISABLED (local only)        ║`;
  
  console.log(`
╔═══════════════════════════════════════════╗
║     🚀 TempMail Server đang chạy!         ║
║                                           ║
║     URL: http://localhost:${PORT}         ║
║     Mode: ${proxyMode.padEnd(32)} ║
${proxyStatus}
║                                           ║
║     API Endpoints:                        ║
║     - POST /api/init                      ║
║     - POST /api/email/create              ║
║     - POST /api/email/random              ║
║     - GET  /api/messages                  ║
║     - GET  /api/email/current             ║
║     - DELETE /api/email                   ║
║     - POST /api/domain                    ║
║     - GET  /api/domains                   ║
║     - GET  /api/stats                     ║
║     - GET  /health                        ║
╚═══════════════════════════════════════════╝
  `);
  
  if (CONFIG.USE_PROXY && !CONFIG.SCRAPERAPI_KEY) {
    console.log('\n⚠️  WARNING: USE_PROXY=true but SCRAPERAPI_KEY is not set!');
    console.log('    Get your free API key at: https://www.scraperapi.com/\n');
  }
});

export default app;

