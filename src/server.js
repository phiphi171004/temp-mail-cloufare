// Load environment variables từ .env file (phải load trước khi import CONFIG)
import 'dotenv/config';

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import { fetchVideoData, getSupportedPlatforms, handleYTSaveDownload } from './video-downloader.js';
import { TempMail } from './tempmail.js';
import { CONFIG } from './config.js';
import {
  initDatabase,
  createAdminConfigTable,
  getAdminConfigFromDB,
  saveAdminConfigToDB,
  isDatabaseAvailable,
  getSiteStats,
  incrementSiteStat
} from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;

// Track server start time for uptime
const serverStartTime = Date.now();

// Heartbeat tracking — mỗi user ping mỗi 5 giây, expire sau 15 giây
const activeUsers = new Map(); // visitorId -> lastPingTime
setInterval(() => {
  const now = Date.now();
  for (const [id, lastPing] of activeUsers) {
    if (now - lastPing > 15000) { // 15 giây không ping = offline
      activeUsers.delete(id);
    }
  }
}, 10000); // Cleanup mỗi 10 giây

// Middleware
app.use(express.json());

// CORS middleware - cho phép request từ các origin khác
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Session-ID');
  // Cho phép frontend đọc response header X-Session-ID (khi server auto-generate)
  res.header('Access-Control-Expose-Headers', 'X-Session-ID');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Auto-generate X-Session-ID nếu client không gửi
// - Tránh dính chung session "default"
// - Trả lại sessionId qua response header để client có thể lưu và tái sử dụng
app.use((req, res, next) => {
  const incoming = req.headers['x-session-id'];
  if (!incoming) {
    const generated = (crypto.randomUUID && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
    req.headers['x-session-id'] = generated;
    res.setHeader('X-Session-ID', generated);
  } else {
    // Echo lại để client dễ debug / đồng bộ
    res.setHeader('X-Session-ID', incoming);
  }
  next();
});

// ============================================
// ENCRYPTION MODULE (Backend)
// ============================================
// ENCRYPTION_KEY từ CONFIG (đã đọc từ env)
// Cùng key với frontend (hardcode trong app.js)
const ENCRYPTION_KEY = CONFIG.ENCRYPTION_SECRET;

// Derive key từ ENCRYPTION_KEY (Pre-shared key)
function deriveKey() {
  // Dùng ENCRYPTION_KEY trực tiếp để derive key (giống frontend)
  const secretKey = ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32);
  const salt = 'temp-mail-salt';
  const iterations = 100000;

  return crypto.pbkdf2Sync(secretKey, salt, iterations, 32, 'sha256');
}

// Mã hóa payload (dùng pre-shared key)
function encryptPayload(data) {
  const dataStr = JSON.stringify(data);
  const algorithm = 'aes-256-gcm';
  const key = deriveKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(dataStr, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Combine IV + encrypted data + authTag (frontend format: IV + encrypted)
  // Nhưng backend cần authTag, nên ta sẽ thêm authTag vào cuối
  const combined = Buffer.concat([
    iv,
    encrypted,
    authTag
  ]);

  return combined.toString('base64');
}

// Giải mã payload (dùng pre-shared key)
function decryptPayload(encryptedBase64) {
  try {
    const combined = Buffer.from(encryptedBase64, 'base64');
    const algorithm = 'aes-256-gcm';
    const key = deriveKey();

    // Frontend format: IV (12 bytes) + encrypted data + authTag (16 bytes)
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const authTag = encrypted.slice(-16);
    const actualEncrypted = encrypted.slice(0, -16);

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(actualEncrypted, null, 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error('Failed to decrypt payload: ' + error.message);
  }
}

// Store temp mail instances per session (simplified, use Redis in production)
const sessions = new Map();

// ===== SITE STATS (in-memory, resets on restart) =====
const siteStats = {
  totalEmailsCreated: 0,
  totalMessagesReceived: 0
};
// Tracking unique messages to avoid counting duplicates
const countedMessageIds = new Set();

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

// ============================================
// CATCH-ALL ROUTE (Dynamic Endpoint Handler)
// ============================================
// Route này phải đặt TRƯỚC các route cụ thể để catch tất cả requests
// Xử lý cả GET và POST requests với dynamic endpoint
app.all('*', async (req, res, next) => {
  // Skip nếu là static files, health check, root
  if (req.path.startsWith('/health') || req.path === '/' ||
    req.path.startsWith('/index.html') || req.path.startsWith('/app.js') ||
    req.path === '/api/admin/encryption-status' ||
    req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
    return next();
  }

  // Nếu mã hóa tắt, bypass catch-all route
  if (!CONFIG.ENCRYPTION_ENABLED) {
    return next();
  }

  // Chỉ xử lý POST requests với encrypted payload
  if (req.method !== 'POST') {
    return next();
  }

  // Kiểm tra nếu có encrypted payload
  if (!req.body || !req.body.encrypted) {
    return next(); // Không phải encrypted request, pass to next route
  }

  try {
    // Giải mã payload (dùng pre-shared key)
    const sessionId = req.headers['x-session-id'] || 'default';
    const decrypted = decryptPayload(req.body.encrypted);
    const { real_endpoint, method, payload, timestamp, nonce } = decrypted;

    // Validate timestamp (reject requests older than 5 minutes)
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        error: 'Request expired'
      });
    }

    // Route tới handler tương ứng (sessionId đã được lấy ở trên)
    const tempMail = getTempMail(sessionId);

    // Map endpoint tới handler
    let result;

    if (real_endpoint === '/api/domains' && method === 'GET') {
      result = {
        success: true,
        domains: tempMail.getDomains(),
        source: tempMail.getCurrentSourceInfo()
      };
    } else if (real_endpoint === '/api/sources' && method === 'GET') {
      result = {
        success: true,
        sources: tempMail.getAllSources(),
        current: tempMail.getCurrentSourceInfo()
      };
    } else if (real_endpoint === '/api/source/switch' && method === 'POST') {
      const { sourceId } = payload || {};
      if (!sourceId) {
        result = { success: false, error: 'sourceId is required' };
      } else {
        await tempMail.switchSource(sourceId);
        result = {
          success: true,
          message: `Đã chuyển sang nguồn: ${sourceId}`,
          source: tempMail.getCurrentSourceInfo()
        };
      }
    } else if (real_endpoint === '/api/init' && method === 'POST') {
      const { sourceId } = payload || {};
      await tempMail.init(sourceId || 'noopmail');
      result = {
        success: true,
        message: 'Session initialized',
        source: tempMail.getCurrentSourceInfo()
      };
    } else if (real_endpoint === '/api/email/create' && method === 'POST') {
      const { username, domain } = payload || {};
      const currentSource = tempMail.getCurrentSourceInfo()?.id || 'noopmail';
      // eTempMail không bắt buộc username (có thể null để random)
      if (currentSource !== 'etempmail' && !username) {
        result = { success: false, error: 'Username is required' };
      } else {
        // eTempMail: có thể truyền null cho username để random
        const finalUsername = (currentSource === 'etempmail') ? (username || null) : username;
        result = await tempMail.createEmail(finalUsername, domain);
      }
    } else if (real_endpoint === '/api/email/random' && method === 'POST') {
      result = await tempMail.createRandomEmail();
    } else if (real_endpoint === '/api/email/sync' && method === 'POST') {
      const { email, secretKey, token } = payload || {};
      if (!email) {
        result = { success: false, error: 'Email is required' };
      } else {
        const sourceId = tempMail.getCurrentSourceInfo()?.id || 'noopmail';
        if (!tempMail.client) {
          await tempMail.init(sourceId);
        }
        tempMail.currentEmail = email;
        if (sourceId === 'temporarymail' && secretKey && tempMail.client) {
          tempMail.client.secretKey = secretKey;
        }
        if (sourceId === 'mailio' && token && tempMail.client) {
          tempMail.client.token = token;
        }
        await tempMail.syncEmailOnReload();
        result = { success: true, message: 'Email synced successfully' };
      }
    } else if (real_endpoint === '/api/messages' && method === 'GET') {
      result = await tempMail.fetchMessages();
    } else if (real_endpoint.startsWith('/api/message/') && method === 'GET') {
      const messageId = real_endpoint.replace('/api/message/', '');
      const detailResult = await tempMail.getMessageDetail(messageId);
      if (detailResult.success) {
        result = {
          success: true,
          message: {
            content: detailResult.content || detailResult.content_raw || '',
            content_raw: detailResult.content_raw || detailResult.content || '',
            html: detailResult.html || null,
            text: detailResult.text || null,
            subject: detailResult.subject || '',
            from: detailResult.from || '',
            to: detailResult.to || '',
            date: detailResult.date || null,
            hasAttm: detailResult.hasAttm || 0
          }
        };
      } else {
        result = detailResult;
      }
    } else if (real_endpoint === '/api/polling/start' && method === 'POST') {
      const { interval = 3000 } = payload || {};
      tempMail.startPolling(interval, () => { });
      result = { success: true, message: 'Polling đã được bắt đầu' };
    } else if (real_endpoint === '/api/polling/stop' && method === 'POST') {
      tempMail.stopPolling();
      result = { success: true, message: 'Polling đã được dừng' };
    } else if (real_endpoint === '/api/email/current' && method === 'GET') {
      result = {
        success: true,
        email: tempMail.getCurrentEmail(),
        emails: tempMail.getAllEmails()
      };
    } else if (real_endpoint === '/api/email' && method === 'DELETE') {
      result = await tempMail.deleteEmail();
    } else if (real_endpoint === '/api/domain' && method === 'POST') {
      const { domain } = payload || {};
      if (!domain) {
        result = { success: false, error: 'Domain is required' };
      } else {
        result = await tempMail.setDomain(domain);
      }
    } else if (real_endpoint === '/api/stats' && method === 'GET') {
      if (!CONFIG.USE_PROXY) {
        result = {
          success: true,
          proxyEnabled: false,
          stats: null,
          message: 'Direct mode (no proxy)'
        };
      } else {
        const stats = tempMail.client.getProxyStats();
        result = {
          success: true,
          proxyEnabled: true,
          stats: stats,
          message: 'ScraperAPI is enabled'
        };
      }
    } else {
      // Endpoint không được hỗ trợ
      return res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      });
    }

    // Mã hóa response và trả về (dùng pre-shared key)
    const encryptedResponse = encryptPayload(result);
    res.json({ encrypted: encryptedResponse });

  } catch (error) {
    // Catch-all route error
    const errorResult = {
      success: false,
      error: error.message
    };
    try {
      const encryptedResponse = encryptPayload(errorResult);
      res.status(500).json({ encrypted: encryptedResponse });
    } catch (encryptError) {
      res.status(500).json(errorResult);
    }
  }
});

// Routes (giữ lại để backward compatibility, nhưng sẽ không được gọi nếu đã qua catch-all)

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
    await tempMail.init(sourceId || 'noopmail');
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
  const currentSource = tempMail.getCurrentSourceInfo()?.id || 'noopmail';

  // eTempMail không bắt buộc username (có thể null để random)
  if (currentSource !== 'etempmail' && !username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required'
    });
  }

  try {
    // eTempMail: có thể truyền null cho username để random
    const finalUsername = (currentSource === 'etempmail') ? (username || null) : username;
    const result = await tempMail.createEmail(finalUsername, domain);
    if (result.success) {
      const ok = await incrementSiteStat('totalEmailsCreated', 1);
      console.log('[Stats] Email created, DB increment:', ok ? 'OK' : 'FAILED');
    }
    res.json(result);
  } catch (error) {
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

  try {
    const result = await tempMail.createRandomEmail();
    if (result.success) {
      const ok = await incrementSiteStat('totalEmailsCreated', 1);
      console.log('[Stats] Random email created, DB increment:', ok ? 'OK' : 'FAILED');
    }
    res.json(result);
  } catch (error) {
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
  const { email, secretKey, token, cookies, tempmailapiPassword } = req.body;

  console.log('\n[Server] POST /api/email/sync');
  console.log('[Server] Email from request:', email);
  console.log('[Server] Source:', tempMail.getCurrentSourceInfo()?.id || 'unknown');
  console.log('[Server] Current email before sync:', tempMail.getCurrentEmail());

  if (!email) {
    console.log('[Server] ERROR: Email is required but not provided');
    return res.status(400).json({
      success: false,
      error: 'Email is required'
    });
  }

  try {
    // QUAN TRỌNG: Đảm bảo client đã được init trước khi sync
    // Vì khi reload, session mới được tạo nhưng client chưa init
    const sourceId = tempMail.getCurrentSourceInfo()?.id || 'noopmail';
    console.log('[Server] Source ID:', sourceId);
    console.log('[Server] Client exists before init:', !!tempMail.client);

    if (!tempMail.client) {
      console.log('[Server] Client not initialized, initializing...');
      await tempMail.init(sourceId);
      console.log('[Server] Client initialized');
    }

    // QUAN TRỌNG: Set email vào tempMail.currentEmail trước khi sync
    // Để fetchMessages() có thể tìm thấy email
    tempMail.currentEmail = email;
    console.log('[Server] Current email set to:', tempMail.currentEmail);

    // TemporaryMail: Set secretKey vào client nếu có
    if (sourceId === 'temporarymail' && secretKey && tempMail.client) {
      tempMail.client.secretKey = secretKey;
      console.log('[Server] TemporaryMail secretKey set');
    }

    // MailIO: Set token vào client nếu có
    if (sourceId === 'mailio' && token && tempMail.client) {
      tempMail.client.token = token;
      console.log('[Server] MailIO token set');
    }

    // EduMail: Set cookies vào client nếu có
    if (sourceId === 'edumail' && cookies && tempMail.client) {
      tempMail.client.savedCookies = cookies;
      console.log('[Server] EduMail cookies saved for restore');
    }

    // Apple: Set token vào client nếu có
    if (sourceId === 'apple' && token && tempMail.client) {
      tempMail.client.token = token;
      console.log('[Server] Apple token set');
    }


    console.log('[Server] Calling syncEmailOnReload()...');
    await tempMail.syncEmailOnReload();
    console.log('[Server] syncEmailOnReload() completed');

    res.json({
      success: true,
      message: 'Email synced successfully'
    });
  } catch (error) {
    console.error('[Server] syncEmailOnReload error:', error.message);
    console.error('[Server] Error stack:', error.stack);
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

  console.log('\n[Server] GET /api/messages');
  console.log('[Server] Source:', sourceId);
  console.log('[Server] Current email:', currentEmail);

  try {
    const result = await tempMail.fetchMessages();
    console.log('[Server] FetchMessages result:', {
      success: result.success,
      count: result.count || 0,
      error: result.error || null,
      messagesCount: result.messages ? result.messages.length : 0
    });
    if (result.messages && result.messages.length > 0) {
      // Count unique new messages
      let newMsgCount = 0;
      result.messages.forEach(msg => {
        const msgKey = `${currentEmail}:${msg.id || msg.m_id}`;
        if (!countedMessageIds.has(msgKey)) {
          countedMessageIds.add(msgKey);
          newMsgCount++;
        }
      });
      if (newMsgCount > 0) incrementSiteStat('totalMessagesReceived', newMsgCount);
      console.log('[Server] First message:', {
        id: result.messages[0].id,
        subject: result.messages[0].subject,
        sender: result.messages[0].sender_name || result.messages[0].sender_email
      });
    }
    res.json(result);
  } catch (error) {
    console.error('[Server] FetchMessages error:', error.message);
    console.error('[Server] Error stack:', error.stack);
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
    // GET /api/message exception
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUBLIC API (alias) - Tách namespace khỏi các route nội bộ (/api/...)
 *  - GET  /api-public/sources
 *  - GET  /api-public/domains?sourceId=...
 *  - POST /api-public/email/create
 *  - GET  /api-public/messages
 *  - GET  /api-public/message/:messageId
 */
app.get('/api-public/sources', (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);

  res.json({
    success: true,
    sources: tempMail.getAllSources(),
    current: tempMail.getCurrentSourceInfo()
  });
});

app.get('/api-public/domains', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);

  const sourceId = (req.query?.sourceId || '').toString().trim();

  try {
    if (sourceId && sourceId !== tempMail.getCurrentSourceInfo()?.id) {
      // Set current source cho session để các bước create/messages dùng cùng 1 nguồn
      await tempMail.switchSource(sourceId);
    } else if (sourceId && sourceId === tempMail.getCurrentSourceInfo()?.id) {
      // no-op
    }

    res.json({
      success: true,
      source: tempMail.getCurrentSourceInfo(),
      domains: tempMail.getDomains()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api-public/email/create', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const { username, domain, sourceId } = req.body || {};

  // Cho phép client chỉ định sourceId ngay trong bước create
  // (không cần switch riêng)
  const wantedSourceId = (sourceId || '').toString().trim();
  if (wantedSourceId && wantedSourceId !== tempMail.getCurrentSourceInfo()?.id) {
    try {
      await tempMail.switchSource(wantedSourceId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  const currentSource = tempMail.getCurrentSourceInfo()?.id || 'noopmail';

  // eTempMail không bắt buộc username (có thể null để random)
  if (currentSource !== 'etempmail' && !username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required'
    });
  }

  try {
    const finalUsername = (currentSource === 'etempmail') ? (username || null) : username;
    const result = await tempMail.createEmail(finalUsername, domain);
    if (result.success) {
      const ok = await incrementSiteStat('totalEmailsCreated', 1);
      console.log('[Stats] Public API: email created, DB increment:', ok ? 'OK' : 'FAILED');
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api-public/messages', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const currentEmail = tempMail.getCurrentEmail();

  try {
    const result = await tempMail.fetchMessages();

    if (result.messages && result.messages.length > 0) {
      // Count unique new messages
      let newMsgCount = 0;
      result.messages.forEach(msg => {
        const msgKey = `${currentEmail}:${msg.id || msg.m_id}`;
        if (!countedMessageIds.has(msgKey)) {
          countedMessageIds.add(msgKey);
          newMsgCount++;
        }
      });
      if (newMsgCount > 0) incrementSiteStat('totalMessagesReceived', newMsgCount);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api-public/message/:messageId', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  const tempMail = getTempMail(sessionId);
  const { messageId } = req.params;

  try {
    const result = await tempMail.getMessageDetail(messageId);

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
      // Callback khi có mail mới
      if (result.success && result.messages && result.messages.length > 0) {
        // Có mail mới
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

// ============================================
// SITE STATS ENDPOINT (Footer)
// ============================================
app.get('/api/site-stats', async (req, res) => {
  try {
    const dbStats = await getSiteStats();
    res.json({
      success: true,
      emailsCreated: dbStats.totalEmailsCreated || 0,
      messagesReceived: dbStats.totalMessagesReceived || 0,
      onlineUsers: activeUsers.size || 1
    });
  } catch (error) {
    res.json({
      success: true,
      emailsCreated: 0,
      messagesReceived: 0,
      onlineUsers: activeUsers.size || 1
    });
  }
});

// POST /api/check - Heartbeat để track online users
app.post('/api/check', (req, res) => {
  // Dùng IP + User-Agent làm visitor ID
  const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const visitorId = `${ip}_${ua.substring(0, 50)}`;
  activeUsers.set(visitorId, Date.now());
  res.json({ success: true, online: activeUsers.size });
});

// POST /api/mailtotal - Tăng totalEmailsCreated
app.post('/api/mailtotal', async (req, res) => {
  try {
    await incrementSiteStat('totalEmailsCreated', 1);
    const stats = await getSiteStats();
    res.json({ success: true, totalEmailsCreated: stats.totalEmailsCreated || 0 });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST /api/mailreceived - Tăng totalMessagesReceived
app.post('/api/mailreceived', async (req, res) => {
  const { count } = req.body;
  try {
    await incrementSiteStat('totalMessagesReceived', count || 1);
    const stats = await getSiteStats();
    res.json({ success: true, totalMessagesReceived: stats.totalMessagesReceived || 0 });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// IP INFO PROXY ENDPOINT
// ============================================
app.get('/api/ipinfo', async (req, res) => {
  try {
    const axios = (await import('axios')).default;
    // Lấy IP thật của client từ header (hỗ trợ proxy/cloudflare)
    let clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    // Nếu IP là localhost/private hoặc IPv6 → lấy IPv4 public từ ipify
    const isPrivate = !clientIP || clientIP === '127.0.0.1' || clientIP === '::1' || clientIP.startsWith('192.168.') || clientIP.startsWith('10.') || clientIP.includes(':');
    if (isPrivate) {
      const { data: ipData } = await axios.get('https://api4.ipify.org?format=json', { timeout: 5000 });
      clientIP = ipData.ip;
    }
    const { data } = await axios.get(`https://ipwho.is/${clientIP}`, { timeout: 5000 });
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Không thể lấy thông tin IP' });
  }
});

// ============================================
// VIDEO DOWNLOADER API ENDPOINTS
// ============================================

// Lấy danh sách platform hỗ trợ
app.get('/api/video/platforms', (req, res) => {
  res.json({ success: true, platforms: getSupportedPlatforms() });
});

// Fetch video data từ URL
app.post('/api/video/download', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL là bắt buộc' });
    }
    console.log('[Video Downloader] Fetching:', url);
    const result = await fetchVideoData(url);
    console.log('[Video Downloader] Success for platform:', result.platform);
    res.json(result);
  } catch (error) {
    console.error('[Video Downloader] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// YouTube download via YTSave - xử lý render/merge cho 1080p+
app.post('/api/video/youtube/ytsave', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Thiếu url' });
  }
  console.log('[YTSave Download] Processing:', url);
  await handleYTSaveDownload(url, res);
});

// Proxy download - tải file từ CDN bên ngoài và trả về dưới dạng attachment
app.get('/api/video/proxy-download', async (req, res) => {
  const { url, filename } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Thiếu url' });
  }
  try {
    console.log('[Proxy Download] Downloading:', url);
    const axios = (await import('axios')).default;
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'referer': 'https://www.tiktok.com/',
      },
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const safeName = (filename || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (error) {
    console.error('[Proxy Download] Error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Không thể tải file: ' + error.message });
    }
  }
});

// ============================================
// ADMIN API ENDPOINTS
// ============================================

const ADMIN_CONFIG_PATH = path.join(__dirname, 'admin-config.json');

// Helper: Read admin config (from DB or file)
async function readAdminConfig() {
  // Known sources - tất cả nguồn mail có trong hệ thống
  const knownSources = [
    'tmail', 'noopmail', 'temporarymail', 'mailio', 'pmail',
    'etempmail', 'tinyhost', 'edumail', 'apple', 'generatoremail', 'moakt', 'tempmailapi', 'inboxes'
  ];

  let config = null;

  // Try database first
  if (isDatabaseAvailable()) {
    config = await getAdminConfigFromDB();
  }

  // Fallback to file
  if (!config) {
    try {
      const data = fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8');
      config = JSON.parse(data);
    } catch (error) {
      // Default config if file doesn't exist
      config = {
        defaultSource: 'noopmail',
        enabledSources: {
          tmail: true,
          noopmail: true,
          temporarymail: true,
          mailio: true,
          pmail: true,
          etempmail: true,
          generatoremail: true,
          moakt: true,
          tempmailapi: true,
          inboxes: true
        },
        adminPassword: '171004' 
      };
    }
  }

  // Auto-merge: thêm các nguồn mới chưa có trong config (mặc định bật)
  if (config && config.enabledSources) {
    let updated = false;
    knownSources.forEach(sourceId => {
      if (!(sourceId in config.enabledSources)) {
        config.enabledSources[sourceId] = true;
        updated = true;
        console.log(`[AdminConfig] Auto-added new source: ${sourceId}`);
      }
    });
    // Lưu lại nếu có thay đổi
    if (updated) {
      await writeAdminConfig(config);
    }
  }

  return config;
}

// Helper: Write admin config (to DB or file)
async function writeAdminConfig(config) {
  // Try database first
  if (isDatabaseAvailable()) {
    const success = await saveAdminConfigToDB(config);
    if (success) return;
  }

  // Fallback to file
  fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * POST /api/admin/login - Admin login
 */
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  const config = await readAdminConfig();

  if (password === config.adminPassword) {
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'Mật khẩu không đúng!' });
  }
});

/**
 * GET /api/admin/config - Get admin config
 */
app.get('/api/admin/config', async (req, res) => {
  const config = await readAdminConfig();
  // Don't send password to client
  const { adminPassword, ...safeConfig } = config;
  res.json({ success: true, config: safeConfig });
});

/**
 * POST /api/admin/toggle-source - Toggle source enabled/disabled
 */
app.post('/api/admin/toggle-source', async (req, res) => {
  const { sourceId, enabled } = req.body;

  if (!sourceId) {
    return res.json({ success: false, error: 'sourceId is required' });
  }

  try {
    const config = await readAdminConfig();

    if (!(sourceId in config.enabledSources)) {
      return res.json({ success: false, error: 'Nguồn không tồn tại!' });
    }

    // Don't allow disabling the default source
    if (!enabled && sourceId === config.defaultSource) {
      return res.json({
        success: false,
        error: 'Không thể tắt nguồn mặc định! Vui lòng chọn nguồn mặc định khác trước.'
      });
    }

    config.enabledSources[sourceId] = enabled;
    await writeAdminConfig(config);

    res.json({ success: true, message: `Đã ${enabled ? 'bật' : 'tắt'} nguồn ${sourceId}` });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/set-default - Set default source
 */
app.post('/api/admin/set-default', async (req, res) => {
  const { sourceId } = req.body;

  if (!sourceId) {
    return res.json({ success: false, error: 'sourceId is required' });
  }

  try {
    const config = await readAdminConfig();

    if (!(sourceId in config.enabledSources)) {
      return res.json({ success: false, error: 'Nguồn không tồn tại!' });
    }

    if (!config.enabledSources[sourceId]) {
      return res.json({ success: false, error: 'Không thể đặt nguồn đã tắt làm mặc định!' });
    }

    config.defaultSource = sourceId;
    await writeAdminConfig(config);

    res.json({ success: true, message: `Đã đặt ${sourceId} làm nguồn mặc định` });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Announcement endpoints
// Public endpoint to fetch current announcement (visible to site users)
app.get('/api/announcement', async (req, res) => {
  try {
    const config = await readAdminConfig();
    res.json({ success: true, announcement: config.announcement || '' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin-only endpoint to update announcement text
app.post('/api/admin/announcement', async (req, res) => {
  const { announcement } = req.body || {};
  if (typeof announcement !== 'string') {
    return res.json({ success: false, error: 'announcement is required' });
  }

  try {
    const config = await readAdminConfig();
    config.announcement = announcement;
    await writeAdminConfig(config);
    res.json({ success: true, message: 'Announcement updated' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sources/enabled - Get enabled sources (for frontend)
 */
app.get('/api/sources/enabled', async (req, res) => {
  try {
    const config = await readAdminConfig();
    const enabledSources = Object.keys(config.enabledSources)
      .filter(sourceId => config.enabledSources[sourceId]);

    res.json({
      success: true,
      sources: enabledSources,
      defaultSource: config.defaultSource
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * GET/HEAD /health - Health check endpoint
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

// HEAD method for health check (same as GET but no body)
app.head('/health', (req, res) => {
  res.status(200).end();
});

/**
 * GET /api/admin/encryption-status - Lấy trạng thái mã hóa (để frontend check)
 */
app.get('/api/admin/encryption-status', (req, res) => {
  res.json({
    success: true,
    enabled: CONFIG.ENCRYPTION_ENABLED
  });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Public API docs (no API key)
app.get('/api-public', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'api-public.html'));
});

// Serve static files (sau route '/' để không override)
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database (if DATABASE_URL is set)
initDatabase();
createAdminConfigTable().catch(err => {
  console.error('[Database] Table creation failed:', err.message);
});

// Start server - listen trên 0.0.0.0 để có thể truy cập từ bên ngoài
app.listen(PORT, '0.0.0.0', () => {
  const proxyMode = CONFIG.USE_PROXY ? '🔄 PROXY (ScraperAPI)' : '⚡ DIRECT';
  const proxyStatus = CONFIG.USE_PROXY
    ? `║     ✓ ScraperAPI: ENABLED                 ║`
    : `║     ⚠ Proxy: DISABLED (local only)        ║`;

  const dbStatus = isDatabaseAvailable()
    ? `║     ✓ Database: CONNECTED (Supabase)      ║`
    : `║     ⚠ Database: FILE-BASED (local only)   ║`;

  console.log(`
╔═══════════════════════════════════════════╗
║     🚀 TempMail Server đang chạy!         ║
║                                           ║
║     URL: http://localhost:${PORT}         ║
║     Mode: ${proxyMode.padEnd(32)}         ║
${proxyStatus}
${dbStatus}
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

