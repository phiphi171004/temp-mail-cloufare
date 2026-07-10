import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * NoopMail Client
 * Client kết nối với noopmail.org
 *
 * API (cập nhật theo capture 2026):
 * - GET  /api/d          → list domains (thường trả [] — đã deprecate)
 * - GET  /api/rd         → random domain { dm, exp, kept }
 * - GET  /api/rd?cur=x   → random domain (đổi domain, tránh cur nếu có)
 * - POST /api/c          → check inbox { e: username, d: domain }
 * - GET  /api/i/{id}     → message detail (html/text/...)
 */
export class NoopMailClient {
  constructor() {
    this.baseURL = 'https://noopmail.org';
    this.domains = [];
    this.currentEmail = null;
    this.currentDomain = null;
    this.domainExpiry = null;
    this.cookies = {};
  }

  /**
   * Khởi tạo client
   */
  async initialize() {
    try {
      // Fetch homepage để lấy cookies
      const response = await axios.get(this.baseURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      // Lưu cookies từ response
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        setCookies.forEach(cookie => {
          const [nameValue] = cookie.split(';');
          const firstEqualIndex = nameValue.indexOf('=');
          if (firstEqualIndex > 0) {
            const name = nameValue.substring(0, firstEqualIndex);
            const value = nameValue.substring(firstEqualIndex + 1);
            this.cookies[name] = value;
          }
        });
      }

      // Load domains (API mới: /api/rd)
      await this.loadDomains();

      return true;
    } catch (error) {
      console.error('Lỗi khởi tạo NoopMail session:', error.message);
      return false;
    }
  }

  /**
   * Headers JSON chuẩn cho API
   */
  getApiHeaders(referer = null) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Cookie': this.getCookieString(),
      'Origin': this.baseURL,
      'Referer': referer || this.baseURL
    };
  }

  /**
   * Lấy 1 domain ngẫu nhiên từ /api/rd
   * @param {string|null} currentDomain - domain hiện tại (truyền vào ?cur=)
   * @returns {Promise<{domain: string|null, exp: string|null, kept: boolean}>}
   */
  async fetchRandomDomain(currentDomain = null) {
    try {
      const url = currentDomain
        ? `${this.baseURL}/api/rd?cur=${encodeURIComponent(currentDomain)}`
        : `${this.baseURL}/api/rd`;

      const response = await axios.get(url, {
        headers: this.getApiHeaders(),
        timeout: 15000
      });

      // Response: { dm: "example.store", exp: "2027-...", kept: false }
      if (response.data && response.data.dm) {
        const dm = String(response.data.dm).trim();
        if (!this.isValidDomain(dm)) {
          return { domain: null, exp: null, kept: false };
        }
        return {
          domain: dm.toLowerCase(),
          exp: response.data.exp || null,
          kept: !!response.data.kept
        };
      }

      return { domain: null, exp: null, kept: false };
    } catch (error) {
      console.error('Lỗi fetch random domain NoopMail (/api/rd):', error.message);
      return { domain: null, exp: null, kept: false };
    }
  }

  /**
   * Load danh sách domains
   * NoopMail đã bỏ list đầy đủ qua /api/d (trả []).
   * Domain lấy qua /api/rd — gọi nhiều lần để có vài lựa chọn cho dropdown.
   */
  async loadDomains() {
    try {
      // 1) Thử API cũ /api/d (nếu họ bật lại list)
      try {
        const legacy = await axios.get(`${this.baseURL}/api/d`, {
          headers: this.getApiHeaders(),
          timeout: 10000
        });
        if (Array.isArray(legacy.data) && legacy.data.length > 0) {
          this.domains = legacy.data
            .map(d => (typeof d === 'string' ? d : d?.domain || d?.dm || d?.name))
            .filter(Boolean);
          if (this.domains.length > 0) {
            if (!this.currentDomain || !this.domains.includes(this.currentDomain)) {
              this.currentDomain = this.domains[0];
            }
            console.log(`[NoopMail] Loaded ${this.domains.length} domains from /api/d`);
            return this.domains;
          }
        }
      } catch (legacyErr) {
        // ignore — dùng /api/rd
      }

      // 2) API mới: /api/rd — lấy nhiều domain ngẫu nhiên cho dropdown
      // Site gốc không còn list cố định; mỗi lần /api/rd trả 1 domain.
      // Gọi xen kẽ có/không ?cur= + delay nhẹ để tránh trả cùng 1 domain.
      const collected = new Set(this.domains);
      const rounds = 10;
      let lastDomain = this.currentDomain || null;

      for (let i = 0; i < rounds; i++) {
        // Xen kẽ: null | lastDomain | empty-cur style
        let curArg = null;
        if (i % 3 === 1 && lastDomain) {
          curArg = lastDomain;
        }

        const result = await this.fetchRandomDomain(curArg);
        if (result.domain) {
          collected.add(result.domain);
          lastDomain = result.domain;
          if (!this.currentDomain) {
            this.currentDomain = result.domain;
            this.domainExpiry = result.exp;
          }
        }

        // Delay nhỏ giữa các request (API có thể sticky nếu spam)
        if (i < rounds - 1) {
          await new Promise(r => setTimeout(r, 120 + Math.floor(Math.random() * 80)));
        }
      }

      this.domains = [...collected];

      if (this.domains.length === 0) {
        console.warn('[NoopMail] Không lấy được domain nào từ /api/rd');
        return [];
      }

      if (!this.currentDomain || !this.domains.includes(this.currentDomain)) {
        this.currentDomain = this.domains[0];
      }

      console.log(`[NoopMail] Loaded ${this.domains.length} domains via /api/rd:`, this.domains.join(', '));
      return this.domains;
    } catch (error) {
      console.error('Lỗi load domains NoopMail:', error.message);
      return [];
    }
  }

  /**
   * Đổi sang domain ngẫu nhiên mới (giống UX site noopmail)
   */
  async changeDomain() {
    const result = await this.fetchRandomDomain(this.currentDomain);
    if (result.domain) {
      this.currentDomain = result.domain;
      this.domainExpiry = result.exp;
      if (!this.domains.includes(result.domain)) {
        this.domains.push(result.domain);
      }
      return {
        success: true,
        domain: result.domain,
        exp: result.exp
      };
    }
    return {
      success: false,
      error: 'Không lấy được domain mới'
    };
  }

  /**
   * Lấy danh sách domains
   */
  getDomains() {
    return this.domains.filter(d => this.isValidDomain(d));
  }

  /**
   * Domain hợp lệ (chặn null / "null" / rỗng — gây ra email user@null)
   */
  isValidDomain(domain) {
    if (domain == null) return false;
    const d = String(domain).trim();
    if (!d) return false;
    if (d === 'null' || d === 'undefined' || d === 'None') return false;
    // domain tối thiểu: a.b
    if (!d.includes('.') || d.length < 3) return false;
    return true;
  }

  /**
   * Chuẩn hóa domain từ input (string/null) → domain hợp lệ hoặc null
   */
  normalizeDomain(domain) {
    if (!this.isValidDomain(domain)) return null;
    return String(domain).trim().toLowerCase();
  }

  /**
   * Đảm bảo có domain usable: current list → /api/rd
   */
  async ensureDomain(preferred = null) {
    let domain = this.normalizeDomain(preferred);

    if (!domain) {
      domain = this.normalizeDomain(this.currentDomain);
    }

    if (!domain && this.domains.length > 0) {
      const valid = this.domains.find(d => this.isValidDomain(d));
      domain = this.normalizeDomain(valid);
    }

    if (!domain) {
      // load lại / gọi random
      if (this.domains.length === 0) {
        await this.loadDomains();
      }
      domain = this.normalizeDomain(this.currentDomain)
        || this.normalizeDomain(this.domains.find(d => this.isValidDomain(d)));
    }

    if (!domain) {
      const rd = await this.fetchRandomDomain(
        this.normalizeDomain(this.currentDomain)
      );
      domain = this.normalizeDomain(rd.domain);
      if (domain) {
        this.domainExpiry = rd.exp;
      }
    }

    if (domain) {
      this.currentDomain = domain;
      if (!this.domains.includes(domain)) {
        this.domains.push(domain);
      }
      // loại bỏ domain rác nếu lỡ cache
      this.domains = this.domains.filter(d => this.isValidDomain(d));
    }

    return domain;
  }

  /**
   * Tạo cookie string từ object
   */
  getCookieString() {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * Tạo email random
   */
  async createRandomEmail() {
    try {
      // Generate random username (12 ký tự, lowercase)
      const username = this.generateRandomUsername(12);

      const selectedDomain = await this.ensureDomain();
      if (!selectedDomain) {
        return {
          success: false,
          error: 'Không có domain khả dụng (NoopMail /api/rd)'
        };
      }

      const email = `${username}@${selectedDomain}`;
      this.currentEmail = email;
      this.currentDomain = selectedDomain;

      return {
        success: true,
        email: email,
        username: username,
        domain: selectedDomain
      };
    } catch (error) {
      console.error('Lỗi tạo email random NoopMail:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email với username tùy chỉnh
   */
  async createEmail(username, domain = null) {
    try {
      // Validate và clean username
      username = username.replace(/[^a-zA-Z0-9.]/gi, '').replace(/\s/g, '');
      if (username.length > 25) {
        username = username.substring(0, 25);
      }
      if (username.length < 1) {
        return {
          success: false,
          error: 'Username phải có ít nhất 1 ký tự'
        };
      }

      // domain có thể là null / "null" / "" từ frontend — normalize trước
      const selectedDomain = await this.ensureDomain(domain);
      if (!selectedDomain) {
        return {
          success: false,
          error: 'Không có domain khả dụng'
        };
      }

      const email = `${username}@${selectedDomain}`;
      this.currentEmail = email;
      this.currentDomain = selectedDomain;

      return {
        success: true,
        email: email,
        username: username,
        domain: selectedDomain
      };
    } catch (error) {
      console.error('Lỗi tạo email NoopMail:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch messages từ inbox
   */
  async fetchMessages() {
    try {
      if (!this.currentEmail) {
        return {
          success: false,
          error: 'Chưa có email nào được chọn',
          messages: [],
          count: 0
        };
      }

      // Parse email để lấy username và domain
      const [username, domain] = this.currentEmail.split('@');
      if (!username || !domain) {
        return {
          success: false,
          error: 'Email không hợp lệ',
          messages: [],
          count: 0
        };
      }

      // Gọi API check inbox
      const response = await axios.post(
        `${this.baseURL}/api/c`,
        {
          e: username,
          d: domain
        },
        {
          headers: {
            ...this.getApiHeaders(),
            'Content-Type': 'application/json;charset=UTF-8'
          },
          timeout: 20000
        }
      );

      // Response là array messages hoặc []
      const messages = Array.isArray(response.data) ? response.data : [];

      // Format messages để đồng nhất với format khác
      const formattedMessages = messages.map((msg, index) => {
        // Parse from field để lấy sender name và email
        let senderName = '';
        let senderEmail = '';
        if (msg.from) {
          const fromMatch = msg.from.match(/^(.+?)\s*<(.+?)>$/);
          if (fromMatch) {
            senderName = fromMatch[1].trim().replace(/^"|"$/g, '');
            senderEmail = fromMatch[2].trim();
          } else {
            senderEmail = msg.from.trim();
            senderName = senderEmail;
          }
        }

        return {
          id: msg.id || `msg-${index}`,
          m_id: msg.m_id || msg.id,
          subject: msg.subject || 'Không có tiêu đề',
          sender_name: senderName,
          sender_email: senderEmail,
          to: msg.to || this.currentEmail,
          date: msg.date || null,
          datediff: this.calculateDateDiff(msg.date),
          timestamp: msg.date ? new Date(msg.date).getTime() : null,
          content: msg.text || '',
          content_raw: msg.text || '',
          hasAttm: msg.hasAttm || 0,
          attachments: []
        };
      });

      return {
        success: true,
        messages: formattedMessages,
        count: formattedMessages.length
      };
    } catch (error) {
      console.error('Lỗi fetch messages NoopMail:', error.message);
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Lấy chi tiết message
   */
  async getMessageDetail(messageId) {
    try {
      // Thử gọi API JSON trước: GET /api/i/{messageId}
      try {
        const jsonResponse = await axios.get(`${this.baseURL}/api/i/${messageId}`, {
          headers: this.getApiHeaders(`${this.baseURL}/detail/?i=${messageId}`),
          timeout: 20000
        });

        // Nếu response là JSON object
        if (jsonResponse.data && typeof jsonResponse.data === 'object') {
          const data = jsonResponse.data;

          // Ưu tiên HTML content, nếu không có thì dùng text
          const content = data.html || data.text || '';
          const contentRaw = data.html || data.text || '';

          if (content) {
            return {
              success: true,
              content: content,
              content_raw: contentRaw,
              html: data.html || null,
              text: data.text || null,
              subject: data.subject || '',
              from: data.from || '',
              to: data.to || '',
              date: data.date || null,
              hasAttm: data.hasAttm || 0
            };
          }
        }
      } catch (jsonError) {
        console.warn('API JSON không khả dụng, thử dùng /detail/:', jsonError.message);
      }

      // Nếu API JSON không có HTML content, gọi /detail/?i={messageId} để lấy HTML
      const htmlResponse = await axios.get(`${this.baseURL}/detail/?i=${messageId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cookie': this.getCookieString(),
          'Origin': this.baseURL,
          'Referer': this.baseURL
        },
        responseType: 'text',
        timeout: 20000
      });

      if (htmlResponse.data && typeof htmlResponse.data === 'string') {
        // Parse HTML để lấy nội dung email từ iframe hoặc script
        const $ = cheerio.load(htmlResponse.data);

        // Tìm iframe với id="ehtmc" và lấy srcdoc hoặc src
        const iframe = $('#ehtmc');
        let htmlContent = '';

        if (iframe.length > 0) {
          const srcdoc = iframe.attr('srcdoc');
          if (srcdoc) {
            htmlContent = srcdoc;
          } else {
            // Nếu không có srcdoc, có thể content được load từ script
            // Tìm trong script tags
            $('script').each((i, elem) => {
              const scriptContent = $(elem).html();
              if (scriptContent && scriptContent.includes('ehtmc')) {
                // Parse script để lấy HTML content nếu có
                const match = scriptContent.match(/srcdoc\s*=\s*["']([^"']+)["']/);
                if (match && match[1]) {
                  htmlContent = match[1];
                }
              }
            });
          }
        }

        // Nếu không tìm thấy trong iframe, thử lấy từ element #mifo hoặc #etxt
        if (!htmlContent) {
          const mifoContent = $('#mifo').html();
          if (mifoContent) {
            htmlContent = mifoContent;
          } else {
            const etxtContent = $('#etxt').text();
            if (etxtContent) {
              htmlContent = etxtContent;
            }
          }
        }

        // Nếu vẫn không có, thử gọi lại API JSON để lấy text content
        if (!htmlContent) {
          try {
            const jsonResponse2 = await axios.get(`${this.baseURL}/api/i/${messageId}`, {
              headers: this.getApiHeaders(`${this.baseURL}/detail/?i=${messageId}`),
              timeout: 20000
            });

            if (jsonResponse2.data && typeof jsonResponse2.data === 'object') {
              const data = jsonResponse2.data;
              htmlContent = data.html || data.text || '';

              return {
                success: true,
                content: htmlContent,
                content_raw: htmlContent,
                html: data.html || null,
                text: data.text || null,
                subject: data.subject || '',
                from: data.from || '',
                to: data.to || '',
                date: data.date || null,
                hasAttm: data.hasAttm || 0
              };
            }
          } catch (e) {
            // Ignore
          }
        }

        if (htmlContent) {
          return {
            success: true,
            content: htmlContent,
            content_raw: htmlContent,
            html: htmlContent,
            text: null,
            subject: '',
            from: '',
            to: '',
            date: null,
            hasAttm: 0
          };
        }
      }

      return {
        success: false,
        error: 'Không thể lấy nội dung message'
      };
    } catch (error) {
      console.error('Lỗi lấy chi tiết message NoopMail:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate random username
   */
  generateRandomUsername(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result.toLowerCase();
  }

  /**
   * Calculate date difference (datediff)
   */
  calculateDateDiff(dateString) {
    if (!dateString) return null;
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Vừa xong';
      if (diffMins < 60) return `${diffMins} phút trước`;
      if (diffHours < 24) return `${diffHours} giờ trước`;
      return `${diffDays} ngày trước`;
    } catch (e) {
      return null;
    }
  }

  /**
   * Set current email (dùng khi sync)
   */
  setCurrentEmail(email) {
    this.currentEmail = email;
    if (email && email.includes('@')) {
      const [, domain] = email.split('@');
      this.currentDomain = domain;
      if (domain && !this.domains.includes(domain)) {
        this.domains.push(domain);
      }
    }
  }

  /**
   * Get current email
   */
  getCurrentEmail() {
    return this.currentEmail;
  }

  /**
   * Get all emails (for compatibility with other clients)
   * NoopMail doesn't maintain a list of emails, so return current email if exists
   */
  getAllEmails() {
    return this.currentEmail ? [this.currentEmail] : [];
  }
}
