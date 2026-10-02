import Imap from 'imap';
import { simpleParser } from 'mailparser';

/**
 * PMAIL Client
 * Email forwarding service - messages được forward về phiphi19784321@gmail.com
 * Fetch messages từ IMAP và filter theo "To" field
 */
export class PMailClient {
  constructor() {
    this.domains = [
      'playmaker.id.vn',
      'mmocoffee.io.vn',
      'phatdinh24.id.vn',
      'pphimchill.app',
      'mailp.tech'
    ];
    this.defaultDomain = 'playmaker.id.vn'; // Domain có nhiều emails nhất
    this.currentEmail = null;
    this.forwardEmail = 'phiphi19784321@gmail.com';

    // OPTIMIZATION: Cache IMAP connection
    this.imapConnection = null;
    this.isConnecting = false;
    this.lastFetchTime = 0;
    this.fetchCooldown = 2000; // 2 giây cooldown giữa các lần fetch

    // IMAP config - cần set trong environment variables
    this.imapConfig = {
      user: process.env.PMAIL_IMAP_USER || 'phiphi19784321@gmail.com',
      password: process.env.PMAIL_IMAP_PASSWORD || '',
      host: process.env.PMAIL_IMAP_HOST || 'imap.gmail.com',
      port: parseInt(process.env.PMAIL_IMAP_PORT || '993'),
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000, // 10 giây timeout
      authTimeout: 5000   // 5 giây auth timeout
    };
  }

  /**
   * Khởi tạo client (không cần API call, chỉ cần setup)
   */
  async initialize() {
    // PMAIL không cần initialize qua API
    // Chỉ cần verify IMAP config
    if (!this.imapConfig.password) {
      console.warn('[PMAIL] IMAP password chưa được cấu hình');
    }
    return true;
  }

  /**
   * Lấy danh sách domains
   */
  getDomains() {
    return this.domains;
  }

  /**
   * Tạo email mới (random hoặc custom)
   */
  async createEmail(username = null, domain = null) {
    try {
      // Generate username nếu không có
      if (!username) {
        username = this.generateRandomUsername();
      }

      // Validate username
      if (username.length < 3 || username.length > 15) {
        return {
          success: false,
          error: 'Username phải có từ 3-15 ký tự'
        };
      }

      // Chọn domain
      const selectedDomain = domain && this.domains.includes(domain)
        ? domain
        : this.defaultDomain;

      const email = `${username}@${selectedDomain}`;
      this.currentEmail = email;

      return {
        success: true,
        email: email,
        username: username,
        domain: selectedDomain
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate random username
   */
  generateRandomUsername() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.floor(Math.random() * 8) + 8; // 8-15 characters
    let username = '';
    for (let i = 0; i < length; i++) {
      username += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return username;
  }

  /**
   * Fetch messages từ IMAP và filter theo "To" field
   */
  async fetchMessages() {
    return new Promise((resolve, reject) => {
      if (!this.currentEmail) {
        return resolve({
          success: false,
          error: 'Chưa có email nào được chọn',
          messages: [],
          count: 0
        });
      }

      if (!this.imapConfig.password) {
        return resolve({
          success: false,
          error: 'IMAP password chưa được cấu hình. Vui lòng set PMAIL_IMAP_PASSWORD trong .env',
          messages: [],
          count: 0
        });
      }

      // OPTIMIZATION: Cooldown check - tránh fetch quá nhanh
      const now = Date.now();
      if (now - this.lastFetchTime < this.fetchCooldown) {
        console.log('[PMAIL] Cooldown active, skipping fetch...');
        return resolve({
          success: true,
          messages: [],
          count: 0,
          cached: true
        });
      }
      this.lastFetchTime = now;

      console.log(`[PMAIL] Fetching messages for: ${this.currentEmail}`);

      const imap = new Imap(this.imapConfig);
      const messages = [];

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return resolve({
              success: false,
              error: `Không thể mở INBOX: ${err.message}`,
              messages: [],
              count: 0
            });
          }

          // Search TẤT CẢ emails gửi đến target (không giới hạn thời gian)
          // Gmail server tự filter - NHANH!
          const searchCriteria = [
            ['OR',
              ['TO', this.currentEmail],
              ['CC', this.currentEmail]
            ]
          ];

          console.log(`[PMAIL] Searching all emails sent to: ${this.currentEmail}`);

          imap.search(searchCriteria, (err, results) => {
            if (err) {
              imap.end();
              return resolve({
                success: false,
                error: `Lỗi search messages: ${err.message}`,
                messages: [],
                count: 0
              });
            }

            if (!results || results.length === 0) {
              imap.end();
              return resolve({
                success: true,
                messages: [],
                count: 0
              });
            }

            // Gmail đã filter → Chỉ lấy 100 emails mới nhất
            const maxMessages = 100;
            const messagesToFetch = results.length > maxMessages
              ? results.slice(-maxMessages)
              : results;
            
            console.log(`[PMAIL] Found ${results.length} emails, fetching ${messagesToFetch.length}`);

            // Fetch full message để có body
            const fetch = imap.fetch(messagesToFetch, {
              bodies: '',
              struct: true
            });

            let processedCount = 0;
            let errorCount = 0;

            // TIMEOUT: Nếu fetch quá 30 giây thì return kết quả hiện tại
            const fetchTimeout = setTimeout(() => {
              console.log(`[PMAIL] Fetch timeout! Processed: ${processedCount}/${messagesToFetch.length}, Returning current results...`);
              imap.end();
              resolve({
                success: true,
                messages: messages,
                count: messages.length,
                timeout: true
              });
            }, 30000);

            fetch.on('message', (msg, seqno) => {
              let buffer = '';

              msg.on('body', (stream, info) => {
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
              });

              msg.once('end', () => {
                processedCount++;
                console.log(`[PMAIL] Processing ${processedCount}/${messagesToFetch.length}`);

                simpleParser(buffer)
                  .then((parsed) => {
                    const targetEmail = this.currentEmail.toLowerCase();

                    // Skip debug logging

                    // Lấy tất cả các địa chỉ email từ các trường khác nhau
                    const toAddresses = [
                      ...(parsed.to?.value || []),
                      ...(parsed.cc?.value || []),
                      ...(parsed.bcc?.value || [])
                    ].map(addr => {
                      // Extract email từ format "Name <email@domain>" hoặc chỉ "email@domain"
                      const emailStr = addr.address?.toLowerCase() || addr.text?.toLowerCase() || String(addr).toLowerCase();
                      return emailStr;
                    });

                    // QUAN TRỌNG: Khi email được forward, cần check trong body và headers
                    // Vì "To" field có thể vẫn là email gốc, nhưng email tạm có thể nằm trong body
                    const headers = parsed.headers || {};

                    // Helper function để lấy header value
                    const getHeaderValue = (headerName) => {
                      if (!headers) return '';
                      const value = headers.get ? headers.get(headerName) : headers[headerName];
                      if (!value) return '';
                      if (Array.isArray(value)) return value[0] || '';
                      if (typeof value === 'string') return value;
                      if (typeof value === 'object' && value.text) return value.text;
                      return String(value || '');
                    };

                    // Lấy các header có thể chứa email tạm
                    const deliveredTo = getHeaderValue('delivered-to').toLowerCase();
                    const envelopeTo = getHeaderValue('envelope-to').toLowerCase();
                    const originalTo = getHeaderValue('x-original-to').toLowerCase();
                    const forwardedFor = getHeaderValue('x-forwarded-for').toLowerCase();

                    // QUAN TRỌNG: Check trong body của email (có thể chứa "tới:" hoặc "To:" với email tạm)
                    const emailBody = (parsed.text || parsed.html || '').toLowerCase();
                    
                    // Extract username và domain từ target email
                    const [targetUsername, targetDomain] = targetEmail.split('@');
                    
                    // Check nhiều điều kiện để match linh hoạt hơn
                    const bodyContainsTargetEmail = 
                      emailBody.includes(targetEmail) || 
                      emailBody.includes(`tới: ${targetEmail}`) ||
                      emailBody.includes(`to: ${targetEmail}`) ||
                      emailBody.includes(`>${targetEmail}<`) ||
                      emailBody.includes(`"${targetEmail}"`) ||
                      // Check username trong subject (có thể email forward có username trong subject)
                      (parsed.subject || '').toLowerCase().includes(targetUsername) ||
                      // Check domain trong subject
                      (parsed.subject || '').toLowerCase().includes(targetDomain);

                    // Kiểm tra tất cả các trường hợp
                    const allAddresses = [
                      ...toAddresses,
                      deliveredTo,
                      envelopeTo,
                      originalTo,
                      forwardedFor
                    ].filter(addr => addr && addr.includes('@'));

                    // Check nếu message được gửi đến currentEmail (email tạm)
                    // Có thể nằm trong "To" field hoặc trong body của email forward
                    const isTargetEmail = allAddresses.some(addr => {
                      // Check exact match hoặc contains
                      const cleanAddr = addr.split('<').pop().split('>')[0].trim();
                      return cleanAddr === targetEmail || addr.includes(targetEmail);
                    }) || bodyContainsTargetEmail;

                    if (isTargetEmail) {
                      // Extract clean HTML content
                      let htmlContent = '';
                      let textContent = '';

                      // Try to get HTML from parsed object
                      if (parsed.html) {
                        htmlContent = typeof parsed.html === 'string' ? parsed.html : parsed.html.toString();
                      } else if (parsed.textAsHtml) {
                        htmlContent = parsed.textAsHtml;
                      }

                      // Get text content
                      if (parsed.text) {
                        textContent = typeof parsed.text === 'string' ? parsed.text : parsed.text.toString();
                      }

                      // Fallback: if no HTML, convert text to HTML
                      if (!htmlContent && textContent) {
                        htmlContent = textContent.replace(/\n/g, '<br>');
                      }

                      // Format message để đồng nhất với format khác
                      const formattedMessage = {
                        id: parsed.messageId || `pmail-${seqno}-${Date.now()}`,
                        subject: parsed.subject || 'Không có tiêu đề',
                        sender_name: parsed.from?.value?.[0]?.name || parsed.from?.text || 'Không rõ',
                        sender_email: parsed.from?.value?.[0]?.address || '',
                        date: parsed.date ? parsed.date.toISOString() : null,
                        datediff: this.calculateDateDiff(parsed.date),
                        timestamp: parsed.date ? parsed.date.getTime() : Date.now(),
                        content: htmlContent || textContent || 'Không có nội dung',
                        content_raw: htmlContent || textContent || '',
                        attachments: parsed.attachments?.map(att => ({
                          filename: att.filename,
                          contentType: att.contentType,
                          size: att.size
                        })) || []
                      };

                      messages.push(formattedMessage);
                    }
                    // Skip debug logging for non-matching messages

                    if (processedCount === messagesToFetch.length) {
                      clearTimeout(fetchTimeout);
                      // Sort messages by timestamp (newest first)
                      messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                      console.log(`[PMAIL] Found ${messages.length} message(s)`);
                      
                      imap.end();
                      resolve({
                        success: true,
                        messages: messages,
                        count: messages.length
                      });
                    }
                  })
                  .catch((parseError) => {
                    console.error('[PMAIL] Error parsing message:', parseError);
                    errorCount++;
                    if (processedCount === messagesToFetch.length) {
                      clearTimeout(fetchTimeout);
                      messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                      imap.end();
                      resolve({
                        success: true,
                        messages: messages,
                        count: messages.length,
                        errors: errorCount
                      });
                    }
                  });
              });
            });

            fetch.once('error', (err) => {
              clearTimeout(fetchTimeout);
              console.error('[PMAIL] Fetch error:', err);
              imap.end();
              resolve({
                success: false,
                error: `Lỗi fetch messages: ${err.message}`,
                messages: messages,
                count: messages.length
              });
            });

            fetch.once('end', () => {
              clearTimeout(fetchTimeout);
              console.log(`[PMAIL] Fetch completed: ${processedCount}/${messagesToFetch.length} messages processed`);
            });
          });
        });
      });

      imap.once('error', (err) => {
        resolve({
          success: false,
          error: `Lỗi kết nối IMAP: ${err.message}`,
          messages: [],
          count: 0
        });
      });

      imap.once('end', () => {
        // Connection ended
      });

      imap.connect();
    });
  }

  /**
   * Calculate date difference (datediff) như các client khác
   */
  calculateDateDiff(date) {
    if (!date) return '';

    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) {
      return `${diffSec} giây trước`;
    } else if (diffMin < 60) {
      return `${diffMin} phút trước`;
    } else if (diffHour < 24) {
      return `${diffHour} giờ trước`;
    } else if (diffDay < 7) {
      return `${diffDay} ngày trước`;
    } else {
      return date.toLocaleDateString('vi-VN');
    }
  }

  /**
   * Get current email
   */
  getCurrentEmail() {
    return this.currentEmail;
  }

  /**
   * Set current email
   */
  setCurrentEmail(email) {
    this.currentEmail = email;
  }
}

