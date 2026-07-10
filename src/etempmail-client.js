import axios from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

/**
 * eTempMail Client (etempmail.com)
 *
 * API (cập nhật 2026):
 * - GET  /                     → cookies + domain list (select options: id + name)
 * - POST /getEmailAddress      → body: { cf_token }  (Cloudflare Turnstile BẮT BUỘC)
 * - POST /changeEmailAddress   → body: id=<domainId>
 * - POST /getInbox             → list messages
 *
 * Lưu ý: Từ khi site gắn Turnstile, request server-side không có cf_token
 * sẽ bị chặn và trả email giả:
 *   never.gonna.give.you.up.bot.brother@get-a-real-job.com.ip_logged
 */
export class ETempMailClient {
  constructor() {
    this.baseURL = 'https://etempmail.com';
    this.cookieJar = new CookieJar();
    this.axios = wrapper(axios.create({
      jar: this.cookieJar,
      withCredentials: true,
      timeout: 30000
    }));

    this.currentEmail = null;
    this.currentDomain = null;
    this.emailId = null;
    this.recoverKey = null;
    this.creationTime = null;

    // Domain mapping (domain name -> domain ID) — load động từ homepage
    this.domainMap = {};
    this.domains = [];
    this.defaultDomain = null;

    // Turnstile sitekey (từ home.js) — chỉ dùng khi có token solver
    this.turnstileSiteKey = '0x4AAAAAADgCwAbwHVdgg5az';
  }

  /**
   * Headers HTML (navigate)
   */
  getBrowserHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    };
  }

  /**
   * Headers XHR/API
   */
  getHeaders(contentType = null) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': this.baseURL,
      'Referer': `${this.baseURL}/`,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  /**
   * Khởi tạo: lấy cookie + load domain list từ homepage
   */
  async initialize() {
    try {
      const response = await this.axios.get(`${this.baseURL}/`, {
        headers: this.getBrowserHeaders()
      });

      const html = typeof response.data === 'string' ? response.data : '';
      this.parseDomainsFromHtml(html);

      // Fallback nếu HTML không parse được (site đổi layout)
      if (this.domains.length === 0) {
        this.domainMap = {
          'temporarmail.edu.pl': 24,
          'mats.edu.pl': 23,
          'securemail.edu.pl': 22
        };
        this.domains = Object.keys(this.domainMap);
        this.defaultDomain = this.domains[0];
        console.warn('[eTempMail] Dùng domain fallback (không parse được từ HTML)');
      } else {
        console.log(`[eTempMail] Loaded ${this.domains.length} domains:`, this.domains.join(', '));
      }

      return true;
    } catch (error) {
      console.error('Lỗi khởi tạo eTempMail client:', error.message);
      return false;
    }
  }

  /**
   * Parse <select><option value="id">domain</option>
   */
  parseDomainsFromHtml(html) {
    if (!html) return;

    const $ = cheerio.load(html);
    const map = {};
    const list = [];

    $('select option').each((_, el) => {
      const id = String($(el).attr('value') || '').trim();
      const name = String($(el).text() || '').trim().toLowerCase();
      if (!id || !name || !name.includes('.')) return;
      // bỏ placeholder "Click here to select!"
      if (!/^\d+$/.test(id)) return;
      map[name] = parseInt(id, 10);
      if (!list.includes(name)) list.push(name);
    });

    // Backup: regex nếu select cấu trúc khác
    if (list.length === 0) {
      const re = /<option[^>]*value=["'](\d+)["'][^>]*>\s*([a-z0-9.-]+\.[a-z]{2,})\s*<\/option>/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const id = parseInt(m[1], 10);
        const name = m[2].toLowerCase();
        map[name] = id;
        if (!list.includes(name)) list.push(name);
      }
    }

    if (list.length > 0) {
      this.domainMap = map;
      this.domains = list;
      this.defaultDomain = list[0];
      if (!this.currentDomain) {
        this.currentDomain = this.defaultDomain;
      }
    }
  }

  /**
   * Nhận diện response anti-bot / IP banned của eTempMail
   */
  isBotBlockedResponse(data) {
    if (!data || typeof data !== 'object') return true;

    const address = String(data.address || data.email || '').toLowerCase();
    const recover = String(data.recover_key || '').toUpperCase();
    const id = String(data.id || '');

    if (!address) return true;

    const botSignals = [
      'get-a-real-job',
      'never.gonna.give.you.up',
      'bot.brother',
      'ip_logged',
      'urnext_job',
      'waiting_for_you'
    ];

    if (botSignals.some(s => address.includes(s) || recover.includes(s.toUpperCase()))) {
      return true;
    }

    // Response bot cố định quan sát được
    if (id === '31313131' && String(data.creation_time) === '0') {
      return true;
    }

    return false;
  }

  botBlockedError() {
    return {
      success: false,
      error:
        'eTempMail chặn bot (Cloudflare Turnstile). ' +
        'API tạo mail bắt buộc cf_token từ captcha — request server không captcha sẽ bị từ chối ' +
        '(trả email giả get-a-real-job.com.ip_logged). ' +
        'Hãy dùng nguồn khác (noopmail, inboxes, …) hoặc giải Turnstile rồi truyền cf_token.',
      code: 'ETEMPMAIL_TURNSTILE_BLOCKED',
      blocked: true
    };
  }

  /**
   * Áp dụng response tạo email nếu hợp lệ
   */
  applyEmailResponse(data) {
    if (this.isBotBlockedResponse(data)) {
      return this.botBlockedError();
    }

    this.currentEmail = data.address;
    this.emailId = data.id;
    this.recoverKey = data.recover_key;
    this.creationTime = data.creation_time;

    if (this.currentEmail.includes('@')) {
      const [, domain] = this.currentEmail.split('@');
      this.currentDomain = domain;
    }

    return {
      success: true,
      email: this.currentEmail,
      username: this.currentEmail.split('@')[0],
      domain: this.currentDomain,
      id: this.emailId,
      recover_key: this.recoverKey,
      creation_time: this.creationTime
    };
  }

  /**
   * Tạo email random
   * @param {string|null} cfToken - Cloudflare Turnstile token (bắt buộc từ ~2026)
   */
  async createRandomEmail(cfToken = null) {
    try {
      // Ưu tiên token truyền vào, sau đó env (nếu có pipeline solver)
      const token = cfToken || process.env.ETEMPMAIL_CF_TOKEN || null;

      // Site browser: $.post(url, { cf_token: token })
      // Không có token → chắc chắn bị bot-block, báo lỗi sớm cho rõ
      if (!token) {
        // Vẫn thử 1 lần (phòng khi họ nới rule) nhưng validate response
        const response = await this.axios.post(
          `${this.baseURL}/getEmailAddress`,
          '', // empty body — old style
          {
            headers: this.getHeaders('application/x-www-form-urlencoded; charset=UTF-8')
          }
        );

        if (response.data && response.data.address) {
          return this.applyEmailResponse(response.data);
        }

        return this.botBlockedError();
      }

      // Form body giống browser jQuery $.post
      const body = new URLSearchParams({ cf_token: token }).toString();
      const response = await this.axios.post(
        `${this.baseURL}/getEmailAddress`,
        body,
        {
          headers: this.getHeaders('application/x-www-form-urlencoded; charset=UTF-8')
        }
      );

      if (response.data && response.data.address) {
        return this.applyEmailResponse(response.data);
      }

      return {
        success: false,
        error: 'Không thể tạo email random (response rỗng)'
      };
    } catch (error) {
      console.error('Lỗi tạo email random eTempMail:', error.message);

      if (error.response && error.response.data) {
        const data = error.response.data;
        if (data.address && this.isBotBlockedResponse(data)) {
          return this.botBlockedError();
        }
        return {
          success: false,
          error: data.error || data.message || 'Không thể tạo email random'
        };
      }

      return {
        success: false,
        error: error.message || 'Không thể tạo email random'
      };
    }
  }

  /**
   * Tạo email với domain tùy chỉnh
   * eTempMail không cho user nhập username — server random
   * @param {string|null} username - bỏ qua (API không hỗ trợ)
   * @param {string|null} domain - tên domain (vd mats.edu.pl)
   * @param {string|null} cfToken - Turnstile token
   */
  async createEmail(username = null, domain = null, cfToken = null) {
    try {
      // Đảm bảo có domain map
      if (this.domains.length === 0) {
        await this.initialize();
      }

      // Nếu có domain hợp lệ → change domain trước
      if (domain && this.domainMap[domain]) {
        const changeResult = await this.changeDomain(domain, { skipCreate: true });
        if (!changeResult.success) {
          return changeResult;
        }
      } else if (domain && !this.domainMap[domain]) {
        // Domain lạ — vẫn cho thử create (server chọn domain mặc định session)
        console.warn(`[eTempMail] Domain "${domain}" không có trong map:`, this.domains);
      }

      return await this.createRandomEmail(cfToken);
    } catch (error) {
      console.error('Lỗi tạo email eTempMail:', error.message);
      return {
        success: false,
        error: error.message || 'Không thể tạo email'
      };
    }
  }

  /**
   * Đổi domain của email
   * @param {string} domain - Domain name
   * @param {{skipCreate?: boolean}} options
   */
  async changeDomain(domain, options = {}) {
    try {
      const domainId = this.domainMap[domain];
      if (!domainId) {
        return {
          success: false,
          error: `Domain ${domain} không hợp lệ. Các domain hợp lệ: ${this.domains.join(', ') || '(chưa load)'}`
        };
      }

      const response = await this.axios.post(
        `${this.baseURL}/changeEmailAddress`,
        `id=${domainId}`,
        {
          headers: {
            ...this.getHeaders('application/x-www-form-urlencoded'),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          maxRedirects: 5,
          validateStatus: (status) => status < 400
        }
      );

      this.currentDomain = domain;

      // Mặc định: sau change thì tạo email mới (cần turnstile)
      if (options.skipCreate) {
        return {
          success: true,
          domain: domain,
          email: this.currentEmail
        };
      }

      const emailResult = await this.createRandomEmail();
      if (emailResult.success) {
        return {
          success: true,
          domain: domain,
          email: emailResult.email
        };
      }

      // change domain OK nhưng create bị chặn turnstile
      return emailResult;
    } catch (error) {
      console.error('Lỗi đổi domain eTempMail:', error.message);
      return {
        success: false,
        error: error.message || 'Không thể đổi domain'
      };
    }
  }

  /**
   * Fetch messages từ inbox
   */
  async fetchMessages() {
    return await this.getInbox();
  }

  /**
   * Lấy danh sách email trong inbox
   */
  async getInbox() {
    try {
      if (!this.currentEmail) {
        return {
          success: false,
          error: 'Chưa tạo email',
          messages: [],
          count: 0
        };
      }

      // Không poll inbox nếu đang là email bot-block
      if (this.isBotBlockedResponse({
        address: this.currentEmail,
        recover_key: this.recoverKey,
        id: this.emailId,
        creation_time: this.creationTime
      })) {
        return {
          success: false,
          error: 'Email bot-block không dùng được — tạo lại sau khi qua Turnstile',
          messages: [],
          count: 0
        };
      }

      const response = await this.axios.post(
        `${this.baseURL}/getInbox`,
        null,
        {
          headers: this.getHeaders()
        }
      );

      if (Array.isArray(response.data)) {
        const messages = response.data.map((msg, index) => ({
          id: index + 1,
          subject: msg.subject || '',
          from: msg.from || '',
          date: msg.date || '',
          body: msg.body || '',
          html: msg.body || '',
          text: this.extractTextFromHTML(msg.body || '')
        }));

        return {
          success: true,
          messages: messages,
          count: messages.length
        };
      }

      return {
        success: true,
        messages: [],
        count: 0
      };
    } catch (error) {
      console.error('Lỗi lấy inbox eTempMail:', error.message);
      return {
        success: false,
        error: error.message || 'Không thể lấy inbox',
        messages: [],
        count: 0
      };
    }
  }

  extractTextFromHTML(html) {
    if (!html) return '';
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getCurrentEmail() {
    return this.currentEmail;
  }

  getDomains() {
    return this.domains;
  }

  getCurrentDomain() {
    return this.currentDomain || this.defaultDomain;
  }

  async extendTime() {
    try {
      const response = await this.axios.post(
        `${this.baseURL}/moreMinutes`,
        null,
        {
          headers: this.getHeaders()
        }
      );

      if (response.data) {
        this.creationTime = response.data.toString();
        return {
          success: true,
          creation_time: this.creationTime
        };
      }

      return {
        success: false,
        error: 'Không thể gia hạn thời gian'
      };
    } catch (error) {
      console.error('Lỗi gia hạn thời gian eTempMail:', error.message);
      return {
        success: false,
        error: error.message || 'Không thể gia hạn thời gian'
      };
    }
  }

  async deleteEmail() {
    try {
      await this.axios.post(
        `${this.baseURL}/deleteEmailAddress`,
        null,
        {
          headers: this.getHeaders()
        }
      );

      this.currentEmail = null;
      this.emailId = null;
      this.recoverKey = null;
      this.creationTime = null;
      this.currentDomain = null;

      return {
        success: true
      };
    } catch (error) {
      console.error('Lỗi xóa email eTempMail:', error.message);
      return {
        success: false,
        error: error.message || 'Không thể xóa email'
      };
    }
  }

  async recoverEmail(recoveryKey) {
    try {
      await this.axios.post(
        `${this.baseURL}/recoverEmailAddress`,
        `key=${encodeURIComponent(recoveryKey)}`,
        {
          headers: {
            ...this.getHeaders('application/x-www-form-urlencoded')
          },
          maxRedirects: 5,
          validateStatus: (status) => status < 400
        }
      );

      const emailResult = await this.createRandomEmail();
      if (emailResult.success) {
        return {
          success: true,
          email: emailResult.email,
          recover_key: emailResult.recover_key
        };
      }

      return emailResult.blocked
        ? emailResult
        : {
          success: false,
          error: 'Không thể khôi phục email'
        };
    } catch (error) {
      console.error('Lỗi khôi phục email eTempMail:', error.message);
      return {
        success: false,
        error: error.message || 'Không thể khôi phục email'
      };
    }
  }
}
