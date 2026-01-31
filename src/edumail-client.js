import axios from 'axios';
import { CONFIG } from './config.js';
import * as cheerio from 'cheerio';

/**
 * EduMail Client (edumailfree.com)
 * Client để tương tác với edumailfree.com API
 * Sử dụng Livewire framework tương tự TMail
 */
export class EduMailClient {
  constructor() {
    this.baseURL = 'https://edumailfree.com';
    this.apiEndpoint = '/livewire/update';
    this.csrfToken = null;
    this.cookies = {};
    this.componentSnapshots = {
      actions: null,
      app: null
    };
    // Cache parsed snapshots để tránh parse JSON nhiều lần
    this._parsedSnapshots = {
      actions: null,
      app: null
    };
    // Proxy stats tracking
    this.proxyStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      errors: []
    };
  }

  /**
   * Xây dựng URL với proxy nếu được bật
   */
  buildProxyURL(targetUrl, isPOST = false) {
    if (!CONFIG.USE_PROXY || !CONFIG.SCRAPERAPI_KEY) {
      return targetUrl;
    }

    const encodedUrl = encodeURIComponent(targetUrl);
    let proxyUrl = `${CONFIG.SCRAPERAPI_URL}?api_key=${CONFIG.SCRAPERAPI_KEY}&url=${encodedUrl}`;
    
    if (isPOST) {
      proxyUrl += '&ultra_premium=true';
      proxyUrl += '&keep_headers=true';
    }
    
    return proxyUrl;
  }

  /**
   * Lấy thống kê proxy
   */
  getProxyStats() {
    if (!CONFIG.USE_PROXY) {
      return null;
    }

    return {
      ...this.proxyStats,
      averageResponseTime: this.proxyStats.totalRequests > 0 
        ? Math.round(this.proxyStats.totalResponseTime / this.proxyStats.totalRequests)
        : 0,
      successRate: this.proxyStats.totalRequests > 0
        ? Math.round((this.proxyStats.successfulRequests / this.proxyStats.totalRequests) * 100)
        : 0
    };
  }

  /**
   * Khởi tạo session - lấy CSRF token và cookies
   */
  async initialize() {
    try {
      const startTime = Date.now();
      const targetUrl = this.buildProxyURL(this.baseURL, false);
      
      if (CONFIG.USE_PROXY) {
        this.proxyStats.totalRequests++;
      }
      
      const response = await axios.get(targetUrl, {
        headers: {
          'user-agent': CONFIG.HEADERS['user-agent'],
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
      
      if (CONFIG.USE_PROXY) {
        const responseTime = Date.now() - startTime;
        this.proxyStats.totalResponseTime += responseTime;
        this.proxyStats.successfulRequests++;
      }

      // Parse CSRF token từ HTML
      const html = response.data;
      const csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);
      if (csrfMatch) {
        this.csrfToken = csrfMatch[1];
      }

      // Lấy cookies từ response
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

      // Parse initial component snapshots từ HTML
      this.parseComponentSnapshots(html);

      return true;
    } catch (error) {
      console.error('[EduMail] Lỗi khởi tạo session:', error.message);
      
      if (CONFIG.USE_PROXY) {
        this.proxyStats.failedRequests++;
        this.proxyStats.errors.push({
          timestamp: new Date().toISOString(),
          error: error.message,
          url: this.baseURL
        });
        if (this.proxyStats.errors.length > 10) {
          this.proxyStats.errors.shift();
        }
      }
      
      return false;
    }
  }

  /**
   * Fetch HTML từ URL và update snapshots
   */
  async fetchAndUpdateSnapshots(url, options = {}) {
    try {
      const fullUrl = url.startsWith('http') ? url : `${this.baseURL}${url.startsWith('/') ? url : '/' + url}`;
      
      const startTime = Date.now();
      const targetUrl = this.buildProxyURL(fullUrl, false);
      
      if (CONFIG.USE_PROXY) {
        this.proxyStats.totalRequests++;
      }
      
      const response = await axios.get(targetUrl, {
        headers: {
          'user-agent': CONFIG.HEADERS['user-agent'],
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'cookie': this.getCookieString()
        }
      });
      
      if (CONFIG.USE_PROXY) {
        const responseTime = Date.now() - startTime;
        this.proxyStats.totalResponseTime += responseTime;
        this.proxyStats.successfulRequests++;
      }

      // Update cookies
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

      // Parse CSRF token mới
      const html = response.data;
      const csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);
      if (csrfMatch) {
        this.csrfToken = csrfMatch[1];
      }

      // Parse snapshots từ HTML
      this.parseComponentSnapshots(html, { skipActions: options.skipActions !== false });
      
      return true;
    } catch (error) {
      console.error('[EduMail] Lỗi fetch HTML:', error.message);
      
      if (CONFIG.USE_PROXY) {
        this.proxyStats.failedRequests++;
        this.proxyStats.errors.push({
          timestamp: new Date().toISOString(),
          error: error.message,
          url: url
        });
        if (this.proxyStats.errors.length > 10) {
          this.proxyStats.errors.shift();
        }
      }
      
      return false;
    }
  }

  /**
   * Parse component snapshots từ HTML
   */
  parseComponentSnapshots(html, options = {}) {
    try {
      const $ = cheerio.load(html);
      
      // Tìm tất cả elements có wire:snapshot
      $('[wire\\:snapshot]').each((index, el) => {
        const snapshot = $(el).attr('wire:snapshot');
        
        if (!snapshot) return;
        
        try {
          // Decode HTML entities
          const decoded = snapshot
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          
          const parsed = JSON.parse(decoded);
          
          // Xác định component type dựa vào name
          if (parsed.memo && parsed.memo.name === 'frontend.actions') {
            if (options.skipActions) {
              return;
            }
            this.componentSnapshots.actions = parsed;
            this._parsedSnapshots.actions = parsed;
          } else if (parsed.memo && parsed.memo.name === 'frontend.app') {
            this.componentSnapshots.app = parsed;
            this._parsedSnapshots.app = parsed;
          }
        } catch (e) {
          // Ignore parse errors
        }
      });
    } catch (e) {
      console.error('[EduMail] Lỗi parse snapshots:', e.message);
    }
  }

  /**
   * Lấy cookies và CSRF token để lưu vào localStorage (cho reload)
   */
  getCookiesForStorage() {
    return JSON.stringify({
      cookies: this.cookies,
      csrfToken: this.csrfToken
    });
  }

  /**
   * Set cookies và CSRF token từ localStorage (khi reload)
   */
  setCookiesFromStorage(cookiesJson) {
    try {
      const data = JSON.parse(cookiesJson);
      this.cookies = data.cookies || {};
      this.csrfToken = data.csrfToken || null;
      return true;
    } catch (e) {
      return false;
    }
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
   * Gửi request đến Livewire endpoint
   */
  async sendRequest(payload) {
    if (!this.csrfToken) {
      console.log('[EduMail] CSRF token missing, initializing...');
      await this.initialize();
    }

    const requestData = {
      _token: this.csrfToken,
      ...payload
    };

    const requestHeaders = {
      ...CONFIG.HEADERS,
      'cookie': this.getCookieString()
    };

    // Debug logging
    console.log('[EduMail] Sending request to:', `${this.baseURL}${this.apiEndpoint}`);
    console.log('[EduMail] Payload components:', payload.components?.length || 0);
    if (payload.components && payload.components.length > 0) {
      payload.components.forEach((comp, idx) => {
        console.log(`[EduMail] Component ${idx}:`, {
          calls: comp.calls?.length || 0,
          updates: Object.keys(comp.updates || {}).length,
          hasSnapshot: !!comp.snapshot
        });
      });
    }

    try {
      const targetUrl = `${this.baseURL}${this.apiEndpoint}`;
      const startTime = Date.now();
      
      let requestUrl = targetUrl;
      let requestOptions = {
        headers: requestHeaders
      };
      
      if (CONFIG.USE_PROXY) {
        this.proxyStats.totalRequests++;
        requestUrl = this.buildProxyURL(targetUrl, true);
        requestOptions = {
          headers: {
            'Content-Type': 'application/json'
          }
        };
      }
      
      let response;
      try {
        response = await axios.post(
          requestUrl,
          requestData,
          requestOptions
        );
      } catch (error) {
        // Log error details
        console.error('[EduMail] Request error:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
        
        // Xử lý lỗi 419 (CSRF token expired)
        if (error.response && error.response.status === 419) {
          console.log('[EduMail] CSRF token expired, re-initializing...');
          await this.initialize();
          requestData._token = this.csrfToken;
          requestHeaders.cookie = this.getCookieString();
          
          response = await axios.post(
            requestUrl,
            requestData,
            { ...requestOptions, headers: requestHeaders }
          );
        } else {
          throw error;
        }
      }
      
      if (CONFIG.USE_PROXY) {
        const responseTime = Date.now() - startTime;
        this.proxyStats.totalResponseTime += responseTime;
        this.proxyStats.successfulRequests++;
      }

      // Update cookies
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

      // Update snapshots từ response
      if (response.data && response.data.components) {
        this.updateSnapshotsFromResponse(response.data.components);
      }

      return response.data;
    } catch (error) {
      console.error('[EduMail] Lỗi gửi request:', error.message);
      
      if (CONFIG.USE_PROXY) {
        this.proxyStats.failedRequests++;
        this.proxyStats.errors.push({
          timestamp: new Date().toISOString(),
          error: error.message,
          status: error.response?.status,
          url: `${this.baseURL}${this.apiEndpoint}`
        });
        if (this.proxyStats.errors.length > 10) {
          this.proxyStats.errors.shift();
        }
      }
      
      throw error;
    }
  }

  /**
   * Update snapshots từ server response
   */
  updateSnapshotsFromResponse(components) {
    if (!Array.isArray(components)) return;
    
    components.forEach(component => {
      if (!component.snapshot) return;
      
      try {
        const snapshot = typeof component.snapshot === 'string' 
          ? JSON.parse(component.snapshot) 
          : component.snapshot;
        
        if (snapshot.memo && snapshot.memo.name === 'frontend.actions') {
          this.componentSnapshots.actions = snapshot;
          this._parsedSnapshots.actions = snapshot;
        } else if (snapshot.memo && snapshot.memo.name === 'frontend.app') {
          this.componentSnapshots.app = snapshot;
          this._parsedSnapshots.app = snapshot;
        }
      } catch (e) {
        // Ignore
      }
    });
  }

  /**
   * Lấy snapshot cho component
   */
  getSnapshot(componentName, emailOverride = null, emailsOverride = null) {
    let snapshot = null;
    
    if (componentName === 'frontend.actions' && this.componentSnapshots.actions) {
      if (!this._parsedSnapshots.actions || 
          this._parsedSnapshots.actions.memo?.id !== this.componentSnapshots.actions.memo?.id) {
        this._parsedSnapshots.actions = JSON.parse(JSON.stringify(this.componentSnapshots.actions));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.actions));
      
      if (emailOverride !== null && emailOverride !== undefined) {
        snapshot.data.email = emailOverride || null;
      }
      
      if (emailsOverride !== null && emailsOverride !== undefined && emailsOverride.length > 0) {
        snapshot.data.emails = [emailsOverride, { s: 'arr' }];
      }
      
      return JSON.stringify(snapshot);
    } else if (componentName === 'frontend.app' && this.componentSnapshots.app) {
      if (!this._parsedSnapshots.app || 
          this._parsedSnapshots.app.memo?.id !== this.componentSnapshots.app.memo?.id) {
        this._parsedSnapshots.app = JSON.parse(JSON.stringify(this.componentSnapshots.app));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.app));
      
      return JSON.stringify(snapshot);
    }
    
    return this.createDefaultSnapshot(componentName, emailOverride, emailsOverride);
  }

  /**
   * Tạo snapshot mặc định
   */
  createDefaultSnapshot(componentName, email = null, emails = []) {
    const id = this.generateId();

    if (componentName === 'frontend.actions') {
      return JSON.stringify({
        data: {
          in_app: false,
          user: null,
          domain: 'students.academic.edu.rs',
          domains: [[
            'academic.edu.rs', 'semar.edu.pl', 'gng.edu.pl', 'agp.edu.pl',
            'gold.edu.pl', 'bcm.edu.pl', 'id.semar.edu.pl', 'dev.semar.edu.pl',
            'student.semar.edu.pl', 'teacher.semar.edu.pl', 'portal.academic.edu.rs',
            'contact.academic.edu.rs', 'students.academic.edu.rs', 'library.gng.edu.pl',
            'research.gng.edu.pl', 'exams.gng.edu.pl', 'lab.agp.edu.pl',
            'up.agp.edu.pl', 'campus.agp.edu.pl', 'prime.gold.edu.pl',
            'student.gold.edu.pl', 'elite.gold.edu.pl', 'dev.bcm.edu.pl',
            'webmail.bcm.edu.pl', 'hr.bcm.edu.pl', 'student.neonet.ac.nz'
          ], { s: 'arr' }],
          email: email || '',
          emails: [emails, { s: 'arr' }],
          captcha: null,
          memberDomains: [[], { s: 'arr' }]
        },
        memo: {
          id: id,
          name: 'frontend.actions',
          path: 'mailbox',
          method: 'GET',
          children: [],
          scripts: [],
          assets: [],
          errors: [],
          locale: 'vi'
        },
        checksum: this.generateChecksum()
      });
    } else if (componentName === 'frontend.app') {
      return JSON.stringify({
        data: {
          messages: [[], { s: 'arr' }],
          deleted: [[], { s: 'arr' }],
          error: '',
          email: email || '',
          initial: false,
          overflow: false
        },
        memo: {
          id: id,
          name: 'frontend.app',
          path: 'mailbox',
          method: 'GET',
          children: [],
          scripts: [],
          assets: [],
          errors: [],
          locale: 'vi'
        },
        checksum: this.generateChecksum()
      });
    }
  }

  /**
   * Generate random ID
   */
  generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 20; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Generate checksum
   */
  generateChecksum() {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  /**
   * Lấy danh sách domains
   */
  getDomains() {
    if (this.componentSnapshots.actions && this.componentSnapshots.actions.data) {
      const domains = this.componentSnapshots.actions.data.domains;
      if (Array.isArray(domains) && domains.length === 2 && domains[1].s === 'arr') {
        return domains[0];
      }
      return domains || [];
    }
    // Default domains cho EduMail
    return [
      'academic.edu.rs', 'semar.edu.pl', 'gng.edu.pl', 'agp.edu.pl',
      'gold.edu.pl', 'bcm.edu.pl', 'student.neonet.ac.nz'
    ];
  }

  /**
   * Lấy email hiện tại
   */
  getCurrentEmail() {
    if (this.componentSnapshots.actions && this.componentSnapshots.actions.data) {
      return this.componentSnapshots.actions.data.email || null;
    }
    return null;
  }

  /**
   * Lấy danh sách emails
   */
  getAllEmails() {
    if (this.componentSnapshots.actions && this.componentSnapshots.actions.data) {
      const emails = this.componentSnapshots.actions.data.emails;
      if (Array.isArray(emails) && emails.length === 2 && emails[1].s === 'arr') {
        return emails[0];
      }
      return emails || [];
    }
    return [];
  }

  /**
   * Tạo email với username tùy chỉnh
   */
  async createEmail(username, domain) {
    const newEmail = `${username}@${domain}`;
    
    // Lấy snapshot
    const actionsSnapshot = this.getSnapshot(
      'frontend.actions',
      null,
      this.getAllEmails()
    );

    const createPayload = {
      components: [
        {
          snapshot: actionsSnapshot,
          calls: [
            {
              path: '',
              method: 'create',
              params: []
            }
          ],
          updates: { 
            user: username,
            domain: domain
          }
        }
      ]
    };

    try {
      const response = await this.sendRequest(createPayload);

      // Update email từ response
      if (response.components && response.components[0]) {
        const component = response.components[0];

        if (component.snapshot) {
          try {
            const snapshotData = JSON.parse(component.snapshot);
            if (snapshotData.data && snapshotData.data.email) {
              // QUAN TRỌNG: Sau khi tạo email, cần fetch lại HTML để lấy snapshot app
              await this.fetchAndUpdateSnapshots('/mailbox', { skipActions: false });
              
              return {
                success: true,
                email: snapshotData.data.email,
                domain: domain
              };
            }
          } catch (e) {
            // Fallback
          }
        }
      }

      // QUAN TRỌNG: Sau khi tạo email, cần fetch lại HTML để lấy snapshot app
      await this.fetchAndUpdateSnapshots('/mailbox', { skipActions: false });

      return {
        success: true,
        email: newEmail,
        domain: domain
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email ngẫu nhiên
   */
  async createRandomEmail() {
    const actionsSnapshot = this.getSnapshot(
      'frontend.actions',
      null,
      this.getAllEmails()
    );

    const payload = {
      components: [
        {
          snapshot: actionsSnapshot,
          calls: [
            {
              path: '',
              method: 'random',
              params: []
            }
          ],
          updates: {}
        }
      ]
    };

    try {
      const response = await this.sendRequest(payload);

      let email = null;
      if (response.components && response.components[0]) {
        const component = response.components[0];
        if (component.snapshot) {
          try {
            const snapshotData = JSON.parse(component.snapshot);
            if (snapshotData.data && snapshotData.data.email) {
              email = snapshotData.data.email;
            }
          } catch (e) {
            // Ignore
          }
        }
      }

      if (!email) {
        email = this.getCurrentEmail();
      }

      if (email) {
        // QUAN TRỌNG: Sau khi tạo email, cần fetch lại HTML để lấy snapshot app
        // Vì response chỉ trả về snapshot actions, không có snapshot app
        await this.fetchAndUpdateSnapshots('/mailbox', { skipActions: false });
        
        return {
          success: true,
          email: email
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email ngẫu nhiên'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch messages
   */
  async fetchMessages() {
    const appSnapshot = this.getSnapshot('frontend.app');

    const payload = {
      components: [
        {
          snapshot: appSnapshot,
          calls: [
            {
              path: '',
              method: '__dispatch',
              params: ['fetchMessages', {}]
            }
          ],
          updates: {}
        }
      ]
    };

    try {
      const response = await this.sendRequest(payload);

      if (response.components && response.components[0]) {
        const component = response.components[0];
        if (component.snapshot) {
          try {
            const snapshotData = JSON.parse(component.snapshot);
            if (snapshotData.data && snapshotData.data.messages) {
              const messages = snapshotData.data.messages;
              let messageArray = messages;
              if (Array.isArray(messages) && messages.length === 2 && messages[1].s === 'arr') {
                messageArray = messages[0];
              }

              // Debug logging
              if (messageArray.length > 0) {
                console.log('[EduMail] Raw messages count:', messageArray.length);
                console.log('[EduMail] First message full:', JSON.stringify(messageArray[0]));
                if (messageArray.length > 1) {
                  console.log('[EduMail] Second message full:', JSON.stringify(messageArray[1]));
                }
              }

              // FIX: Mỗi message là array [data, {s:"arr"}], chỉ lấy phần tử đầu tiên
              const cleanMessages = messageArray
                .filter(msg => Array.isArray(msg) && msg.length >= 1)
                .map(msg => msg[0]);

              return {
                success: true,
                messages: cleanMessages,
                count: cleanMessages.length
              };
            }
          } catch (e) {
            // Ignore
          }
        }
      }

      return {
        success: true,
        messages: [],
        count: 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Sync email
   */
  async syncEmail(email) {
    const actionsSnapshot = this.getSnapshot('frontend.actions', email);
    const appSnapshot = this.getSnapshot('frontend.app', email);

    const payload = {
      components: [
        {
          snapshot: actionsSnapshot,
          calls: [
            {
              path: '',
              method: '__dispatch',
              params: ['syncEmail', { email: email }]
            }
          ],
          updates: {}
        },
        {
          snapshot: appSnapshot,
          calls: [
            {
              path: '',
              method: '__dispatch',
              params: ['syncEmail', { email: email }]
            }
          ],
          updates: {}
        }
      ]
    };

    try {
      await this.sendRequest(payload);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
