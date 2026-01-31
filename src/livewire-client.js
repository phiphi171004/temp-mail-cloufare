import axios from 'axios';
import { CONFIG } from './config.js';
import * as cheerio from 'cheerio';

/**
 * Livewire API Client
 * Xử lý tất cả các request đến Livewire backend
 */
export class LivewireClient {
  constructor() {
    this.baseURL = CONFIG.BASE_URL;
    this.apiEndpoint = CONFIG.API_ENDPOINT;
    this.csrfToken = null;
    this.cookies = {};
    this.componentSnapshots = {
      actions: null,
      app: null
    };
    // TỐI ƯU: Cache parsed snapshots để tránh parse JSON nhiều lần
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

    // ScraperAPI format: http://api.scraperapi.com?api_key=KEY&url=TARGET_URL
    const encodedUrl = encodeURIComponent(targetUrl);
    let proxyUrl = `${CONFIG.SCRAPERAPI_URL}?api_key=${CONFIG.SCRAPERAPI_KEY}&url=${encodedUrl}`;
    
    // Thêm premium parameters để bypass Cloudflare tốt hơn
    // Note: ultra_premium tốn nhiều credits nhưng mạnh nhất
    if (isPOST) {
      proxyUrl += '&ultra_premium=true';  // Use ultra premium for strongest bypass
      proxyUrl += '&keep_headers=true';  // Preserve headers
      // Note: render=true chỉ support GET requests, không dùng cho POST
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
      // Initializing session
      
      const startTime = Date.now();
      const targetUrl = this.buildProxyURL(this.baseURL, false);
      
      if (CONFIG.USE_PROXY) {
        // Using ScraperAPI
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
        // TỐI ƯU: Chỉ log nếu response time > 2s (cảnh báo chậm)
        if (responseTime > 2000) {
          // Slow proxy request
        }
      }

      // Parse CSRF token từ HTML
      const html = response.data;
      const csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);
      if (csrfMatch) {
        this.csrfToken = csrfMatch[1];
        // CSRF Token found
      } else {
        // CSRF Token not found
      }

      // Lấy cookies từ response (FIX: parse đúng với value có nhiều dấu =)
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        // Received cookies
        setCookies.forEach(cookie => {
          const [nameValue] = cookie.split(';');
          const firstEqualIndex = nameValue.indexOf('=');
          if (firstEqualIndex > 0) {
            const name = nameValue.substring(0, firstEqualIndex);
            const value = nameValue.substring(firstEqualIndex + 1);
            this.cookies[name] = value;
            // Cookie received
          }
        });
      } else {
        // No cookies received
      }

      // Parse initial component snapshots từ HTML
      this.parseComponentSnapshots(html);
      // Session initialized

      return true;
    } catch (error) {
      // Lỗi khởi tạo session
      
      if (CONFIG.USE_PROXY) {
        this.proxyStats.failedRequests++;
        this.proxyStats.errors.push({
          timestamp: new Date().toISOString(),
          error: error.message,
          url: this.baseURL
        });
        // Giữ chỉ 10 errors gần nhất
        if (this.proxyStats.errors.length > 10) {
          this.proxyStats.errors.shift();
        }
      }
      
      return false;
    }
  }

  /**
   * Fetch HTML từ URL và update snapshots (dùng khi có redirect)
   * @param {string} url - URL để fetch (có thể là relative hoặc absolute)
   * @param {object} options - Options: { skipActions: true/false } để control có parse actions snapshot không
   */
  async fetchAndUpdateSnapshots(url, options = {}) {
    try {
      // Nếu URL là relative, thêm base URL
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

      // Update cookies nếu có
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

      // Parse CSRF token MỚI từ HTML
      const html = response.data;
      const csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);
      if (csrfMatch) {
        this.csrfToken = csrfMatch[1];
        // Updated CSRF Token
      }

      // Parse snapshots từ HTML
      // Nếu skipActions = true (default): chỉ parse app snapshot (dùng khi create email)
      // Nếu skipActions = false: parse cả actions snapshot (dùng khi delete email để lấy email mới)
      this.parseComponentSnapshots(html, { skipActions: options.skipActions !== false });
      
      return true;
    } catch (error) {
      // Lỗi fetch HTML từ redirect
      
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
   * Parse component snapshots từ HTML (dùng cheerio thay vì regex)
   * @param {string} html - HTML content
   * @param {object} options - Options: { skipActions: true } để skip parse frontend.actions
   */
  parseComponentSnapshots(html, options = {}) {
    try {
      const $ = cheerio.load(html);
      
      // Tìm tất cả elements có wire:snapshot
      $('[wire\\:snapshot]').each((i, el) => {
        const snapshot = $(el).attr('wire:snapshot');
        const xData = $(el).attr('x-data');
        
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
            // Skip nếu option skipActions = true (không ghi đè snapshot đã được update từ response)
            if (options.skipActions) {
              // Skipping actions snapshot
              return;
            }
            this.componentSnapshots.actions = parsed;
            // TỐI ƯU: Cache parsed snapshot luôn
            this._parsedSnapshots.actions = parsed;
            // TỐI ƯU: Giảm log để tăng tốc
            // console.log('✓ Parsed actions snapshot - Email:', parsed.data.email);
          } else if (parsed.memo && parsed.memo.name === 'frontend.app') {
            this.componentSnapshots.app = parsed;
            // TỐI ƯU: Cache parsed snapshot luôn
            this._parsedSnapshots.app = parsed;
            // TỐI ƯU: Giảm log để tăng tốc
            // console.log('✓ Parsed app snapshot - Email:', parsed.data.email || 'null');
          }
        } catch (e) {
          // Bỏ qua lỗi parse
        }
      });
      
      if (!this.componentSnapshots.actions) {
        // Không tìm thấy frontend.actions snapshot
      }
      if (!this.componentSnapshots.app) {
        // Không tìm thấy frontend.app snapshot
      }
    } catch (e) {
      // Lỗi parse snapshots
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

    // TỐI ƯU: Chỉ log debug khi cần (giảm overhead)
    // Uncomment để debug khi cần:
    // console.log('\n=== DEBUG REQUEST ===');
    // console.log('URL:', `${this.baseURL}${this.apiEndpoint}`);
    // console.log('Payload size:', JSON.stringify(requestData).length, 'bytes');

    try {
      const targetUrl = `${this.baseURL}${this.apiEndpoint}`;
      const startTime = Date.now();
      
      // Nếu dùng proxy, route qua ScraperAPI
      let requestUrl = targetUrl;
      let requestMethod = 'post';
      let requestOptions = {
        headers: requestHeaders
      };
      
      if (CONFIG.USE_PROXY) {
        this.proxyStats.totalRequests++;
        // ScraperAPI: POST request with premium parameters
        requestUrl = this.buildProxyURL(targetUrl, true);
        requestOptions = {
          headers: {
            'Content-Type': 'application/json'
          }
        };
        // TỐI ƯU: Giảm log để tăng tốc
        // console.log('🔄 Routing through ScraperAPI with premium features...');
      }
      
      let response;
      try {
        response = await axios.post(
          requestUrl,
          requestData,
          requestOptions
        );
      } catch (error) {
        // Xử lý lỗi 419 (CSRF token expired) - re-initialize và retry 1 lần
        if (error.response && error.response.status === 419) {
          // CSRF token expired, re-initializing
          await this.initialize();
          
          // Update CSRF token trong request
          requestData._token = this.csrfToken;
          requestHeaders.cookie = this.getCookieString();
          
          // Retry request
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
        // Proxy request successful
      }

      // TỐI ƯU: Giảm log để tăng tốc (chỉ log khi cần debug)
      // Uncomment để debug:
      // if (response.data && response.data.components) {
      //   console.log(`✓ Response: ${response.data.components.length} component(s)`);
      // }

      // Update cookies nếu có (FIX: parse đúng với value có nhiều dấu =)
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

      // QUAN TRỌNG: Update snapshots từ response (server trả về snapshot mới với checksum mới!)
      if (response.data && response.data.components) {
        this.updateSnapshotsFromResponse(response.data.components);
      }

      return response.data;
    } catch (error) {
      // Debug error
      if (error.response) {
        // Error response details
      }
      // End debug error
      
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
   * Update snapshots từ server response (sau mỗi request thành công)
   * Server trả về snapshot MỚI với checksum MỚI, phải update để dùng cho request tiếp theo!
   * TỐI ƯU: Cache parsed snapshot luôn để tránh parse lại
   */
  updateSnapshotsFromResponse(components) {
    if (!Array.isArray(components)) return;
    
    components.forEach(component => {
      if (!component.snapshot) return;
      
      try {
        const snapshot = typeof component.snapshot === 'string' 
          ? JSON.parse(component.snapshot) 
          : component.snapshot;
        
        // Update snapshot dựa vào component name
        if (snapshot.memo && snapshot.memo.name === 'frontend.actions') {
          const oldEmail = this.componentSnapshots.actions?.data?.email;
          this.componentSnapshots.actions = snapshot;
          // TỐI ƯU: Cache parsed snapshot luôn
          this._parsedSnapshots.actions = snapshot;
        } else if (snapshot.memo && snapshot.memo.name === 'frontend.app') {
          const oldEmail = this.componentSnapshots.app?.data?.email;
          this.componentSnapshots.app = snapshot;
          // TỐI ƯU: Cache parsed snapshot luôn
          this._parsedSnapshots.app = snapshot;
        }
      } catch (e) {
        // Error parsing snapshot
      }
    });
  }

  /**
   * Lấy snapshot cho component (BẮT BUỘC từ HTML, giữ nguyên ID và checksum!)
   * TỐI ƯU: Cache parsed snapshots để tránh parse JSON nhiều lần
   */
  getSnapshot(componentName, emailOverride = null, emailsOverride = null) {
    let snapshot = null;
    
    // BẮT BUỘC phải có snapshot từ HTML
    if (componentName === 'frontend.actions' && this.componentSnapshots.actions) {
      // TỐI ƯU: Dùng cached parsed snapshot nếu có, nếu không thì parse và cache
      if (!this._parsedSnapshots.actions || 
          this._parsedSnapshots.actions.memo?.id !== this.componentSnapshots.actions.memo?.id) {
        // Snapshot đã thay đổi, parse lại và cache
        this._parsedSnapshots.actions = JSON.parse(JSON.stringify(this.componentSnapshots.actions));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.actions));
      
      // CHỈ update email và emails, GIỮ NGUYÊN id, checksum từ server!
      // Nếu emailOverride !== null và !== undefined: override email
      // Nếu emailOverride === null hoặc undefined: GIỮ NGUYÊN email trong snapshot (không override)
      if (emailOverride !== null && emailOverride !== undefined) {
        snapshot.data.email = emailOverride || null;  // null nếu không có, không phải ""
      }
      // Nếu emailOverride là null/undefined: không làm gì, giữ nguyên email trong snapshot
      
      if (emailsOverride !== null && emailsOverride !== undefined && emailsOverride.length > 0) {
        snapshot.data.emails = [emailsOverride, { s: 'arr' }];
      }
      
      return JSON.stringify(snapshot);
    } else if (componentName === 'frontend.app' && this.componentSnapshots.app) {
      // TỐI ƯU: Dùng cached parsed snapshot nếu có
      if (!this._parsedSnapshots.app || 
          this._parsedSnapshots.app.memo?.id !== this.componentSnapshots.app.memo?.id) {
        // Snapshot đã thay đổi, parse lại và cache
        this._parsedSnapshots.app = JSON.parse(JSON.stringify(this.componentSnapshots.app));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.app));
      
      // QUAN TRỌNG: KHÔNG override email trong snapshot frontend.app!
      // Snapshot từ /mailbox đã có email đúng, nếu override sẽ làm checksum không khớp!
      // Email sẽ được update từ server sau khi gọi syncEmail hoặc fetchMessages
      
      // Chỉ log để debug
      if (emailOverride !== null && snapshot.data.email !== emailOverride) {
        // Snapshot app có email, không override
      }
      
      return JSON.stringify(snapshot);
    }
    
    // FALLBACK: PHẢI CÓ snapshot từ HTML mới hoạt động!
    // Không tìm thấy snapshot
    return this.createDefaultSnapshot(componentName, emailOverride, emailsOverride);
  }

  /**
   * Tạo snapshot mặc định cho component
   */
  createDefaultSnapshot(componentName, email = null, emails = []) {
    const timestamp = Date.now();
    const id = this.generateId();

    if (componentName === 'frontend.actions') {
      return JSON.stringify({
        data: {
          in_app: false,
          user: null,
          domain: CONFIG.DEFAULT_DOMAIN,
          domains: [CONFIG.DOMAINS, { s: 'arr' }],
          email: email || '',
          emails: [emails, { s: 'arr' }],
          captcha: null,
          memberDomains: [[], { s: 'arr' }]
        },
        memo: {
          id: id,
          name: 'frontend.actions',
          path: '/',
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
          path: '/',
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
   * Generate random ID cho component
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
   * Generate checksum giả (không cần chính xác 100%)
   */
  generateChecksum() {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
}

