import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Priyo Email API Client
 * Xử lý tất cả các request đến Priyo Livewire backend
 * Tương tự LivewireClient nhưng có điều chỉnh cho priyo.email
 */
export class PriyoClient {
  constructor() {
    this.baseURL = 'https://priyo.email';
    this.apiEndpoint = '/vi/livewire/update'; // Có thể dùng /livewire/update hoặc /vi/livewire/update
    this.csrfToken = null;
    this.cookies = {};
    this.componentSnapshots = {
      accountActions: null,
      emailHistory: null,
      action: null,
      inboxMessage: null,
      changeAccount: null,
      randomAccount: null,
      createAccount: null
    };
    // Cache parsed snapshots
    this._parsedSnapshots = {
      accountActions: null,
      emailHistory: null,
      action: null,
      inboxMessage: null,
      changeAccount: null,
      randomAccount: null,
      createAccount: null
    };
    this.currentEmail = null;
    this.currentEmails = [];
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
    // Priyo không cần proxy config riêng, dùng chung với CONFIG nếu có
    return targetUrl;
  }

  /**
   * Lấy thống kê proxy
   */
  getProxyStats() {
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
      console.log('[PriyoClient] ========== INITIALIZE START ==========');
      console.log('[PriyoClient] Current email before init:', this.currentEmail);
      console.log('[PriyoClient] InboxMessage snapshot exists before init:', !!this.componentSnapshots.inboxMessage);
      
      // Log messages trong snapshot trước khi init (nếu có)
      if (this.componentSnapshots.inboxMessage && this.componentSnapshots.inboxMessage.data && this.componentSnapshots.inboxMessage.data.messages) {
        const oldMessages = this.componentSnapshots.inboxMessage.data.messages;
        const oldMessagesCount = Array.isArray(oldMessages[0]) && Array.isArray(oldMessages[0][0]) 
          ? oldMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).length
          : 0;
        console.log('[PriyoClient] Messages count BEFORE init:', oldMessagesCount);
        if (oldMessagesCount > 0) {
          console.log('[PriyoClient] Messages IDs BEFORE init:', 
            Array.isArray(oldMessages[0]) && Array.isArray(oldMessages[0][0])
              ? oldMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).map(m => m.id)
              : []);
        }
      }
      
      const startTime = Date.now();
      const targetUrl = this.buildProxyURL(`${this.baseURL}/vi`, false);
      
      this.proxyStats.totalRequests++;
      
      const response = await axios.get(targetUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6'
        }
      });
      
      const responseTime = Date.now() - startTime;
      this.proxyStats.totalResponseTime += responseTime;
      this.proxyStats.successfulRequests++;

      // Parse CSRF token từ script tag data-csrf hoặc meta tag
      const html = response.data;
      let csrfMatch = html.match(/data-csrf="([^"]+)"/);
      if (!csrfMatch) {
        csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);
      }
      if (csrfMatch) {
        this.csrfToken = csrfMatch[1];
        console.log('[PriyoClient] CSRF token obtained:', this.csrfToken.substring(0, 10) + '...');
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
        console.log('[PriyoClient] Cookies updated, count:', Object.keys(this.cookies).length);
      }

      // Parse initial component snapshots từ HTML
      console.log('[PriyoClient] Parsing component snapshots from HTML...');
      this.parseComponentSnapshots(html);
      
      // QUAN TRỌNG: Lấy email từ snapshot sau khi parse (nếu server đã biết email từ cookies/session)
      const preservedEmail = this.currentEmail; // Lưu email hiện tại trước khi extract từ snapshot
      if (this.componentSnapshots.inboxMessage && this.componentSnapshots.inboxMessage.data && this.componentSnapshots.inboxMessage.data.email) {
        const snapshotEmail = this.componentSnapshots.inboxMessage.data.email;
        if (snapshotEmail && snapshotEmail.trim()) {
          console.log('[PriyoClient] Found email in snapshot after init:', snapshotEmail);
          this.currentEmail = snapshotEmail;
        } else if (preservedEmail) {
          // Nếu snapshot không có email nhưng ta có email từ trước, giữ nguyên
          console.log('[PriyoClient] Snapshot has no email, preserving previous email:', preservedEmail);
          this.currentEmail = preservedEmail;
        }
      } else if (preservedEmail) {
        // Nếu không có snapshot email, giữ email từ trước
        console.log('[PriyoClient] No email in snapshot, preserving previous email:', preservedEmail);
        this.currentEmail = preservedEmail;
      }
      
      // Log sau khi parse snapshots
      console.log('[PriyoClient] InboxMessage snapshot exists AFTER init:', !!this.componentSnapshots.inboxMessage);
      if (this.componentSnapshots.inboxMessage && this.componentSnapshots.inboxMessage.data && this.componentSnapshots.inboxMessage.data.messages) {
        const newMessages = this.componentSnapshots.inboxMessage.data.messages;
        const newMessagesCount = Array.isArray(newMessages[0]) && Array.isArray(newMessages[0][0]) 
          ? newMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).length
          : 0;
        console.log('[PriyoClient] Messages count AFTER init:', newMessagesCount);
        if (newMessagesCount > 0) {
          console.log('[PriyoClient] Messages IDs AFTER init:', 
            Array.isArray(newMessages[0]) && Array.isArray(newMessages[0][0])
              ? newMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).map(m => m.id)
              : []);
        } else {
          console.log('[PriyoClient] WARNING: Messages count is 0 after init!');
        }
      } else {
        console.log('[PriyoClient] WARNING: No inboxMessage snapshot or messages after init!');
      }
      
      console.log('[PriyoClient] Current email after init:', this.currentEmail);
      console.log('[PriyoClient] ========== INITIALIZE END ==========');

      return true;
    } catch (error) {
      this.proxyStats.failedRequests++;
      this.proxyStats.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        url: `${this.baseURL}/vi`
      });
      if (this.proxyStats.errors.length > 10) {
        this.proxyStats.errors.shift();
      }
      
      return false;
    }
  }

  /**
   * Fetch HTML từ URL và update snapshots (dùng khi có redirect)
   */
  async fetchAndUpdateSnapshots(url, options = {}) {
    try {
      const fullUrl = url.startsWith('http') ? url : `${this.baseURL}${url.startsWith('/') ? url : '/' + url}`;
      
      const startTime = Date.now();
      const targetUrl = this.buildProxyURL(fullUrl, false);
      
      this.proxyStats.totalRequests++;
      
      const response = await axios.get(targetUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
          'cookie': this.getCookieString()
        }
      });
      
      const responseTime = Date.now() - startTime;
      this.proxyStats.totalResponseTime += responseTime;
      this.proxyStats.successfulRequests++;

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
      let csrfMatch = html.match(/data-csrf="([^"]+)"/);
      if (!csrfMatch) {
        csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);
      }
      if (csrfMatch) {
        this.csrfToken = csrfMatch[1];
      }

      // Parse snapshots từ HTML
      this.parseComponentSnapshots(html, { skipActions: options.skipActions !== false });
      
      return true;
    } catch (error) {
      this.proxyStats.failedRequests++;
      this.proxyStats.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        url: url
      });
      if (this.proxyStats.errors.length > 10) {
        this.proxyStats.errors.shift();
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
      $('[wire\\:snapshot]').each((i, el) => {
        const snapshot = $(el).attr('wire:snapshot');
        const wireId = $(el).attr('wire:id');
        
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
          if (parsed.memo && parsed.memo.name === 'themes.components.account-actions') {
            if (options.skipActions) return;
            this.componentSnapshots.accountActions = parsed;
            this._parsedSnapshots.accountActions = parsed;
            if (parsed.data && parsed.data.email) {
              this.currentEmail = parsed.data.email;
            }
            if (parsed.data && parsed.data.emails && Array.isArray(parsed.data.emails[0])) {
              this.currentEmails = parsed.data.emails[0];
            }
          } else if (parsed.memo && parsed.memo.name === 'themes.components.email-history') {
            this.componentSnapshots.emailHistory = parsed;
            this._parsedSnapshots.emailHistory = parsed;
          } else if (parsed.memo && parsed.memo.name === 'themes.components.action') {
            this.componentSnapshots.action = parsed;
            this._parsedSnapshots.action = parsed;
            if (parsed.data && parsed.data.email) {
              this.currentEmail = parsed.data.email;
            }
          } else if (parsed.memo && parsed.memo.name === 'themes.components.inbox-message') {
            this.componentSnapshots.inboxMessage = parsed;
            this._parsedSnapshots.inboxMessage = parsed;
            if (parsed.data && parsed.data.email) {
              this.currentEmail = parsed.data.email;
            }
            if (parsed.data && parsed.data.emails && Array.isArray(parsed.data.emails[0])) {
              this.currentEmails = parsed.data.emails[0];
            }
          } else if (parsed.memo && parsed.memo.name === 'themes.components.change-account') {
            this.componentSnapshots.changeAccount = parsed;
            this._parsedSnapshots.changeAccount = parsed;
          } else if (parsed.memo && parsed.memo.name === 'themes.components.random-account') {
            this.componentSnapshots.randomAccount = parsed;
            this._parsedSnapshots.randomAccount = parsed;
          } else if (parsed.memo && parsed.memo.name === 'themes.components.create-account') {
            this.componentSnapshots.createAccount = parsed;
            this._parsedSnapshots.createAccount = parsed;
          }
        } catch (e) {
          // Bỏ qua lỗi parse
        }
      });
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
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
      'content-type': 'application/json',
      'origin': this.baseURL,
      'referer': `${this.baseURL}/vi`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'x-livewire': '',
      'cookie': this.getCookieString()
    };

    try {
      const targetUrl = `${this.baseURL}${this.apiEndpoint}`;
      const startTime = Date.now();
      
      console.log('[PriyoClient] sendRequest - URL:', targetUrl);
      console.log('[PriyoClient] sendRequest - Has CSRF token:', !!this.csrfToken);
      console.log('[PriyoClient] sendRequest - Payload keys:', Object.keys(requestData));
      
      let requestUrl = targetUrl;
      let requestOptions = {
        headers: requestHeaders
      };
      
      this.proxyStats.totalRequests++;
      
      let response;
      try {
        response = await axios.post(
          requestUrl,
          requestData,
          requestOptions
        );
        console.log('[PriyoClient] sendRequest - Response status:', response.status);
      } catch (error) {
        console.error('[PriyoClient] sendRequest - Error:', error.message);
        console.error('[PriyoClient] sendRequest - Error status:', error.response?.status);
        console.error('[PriyoClient] sendRequest - Error data:', error.response?.data);
        
        // Xử lý lỗi 419 (CSRF token expired) - re-initialize và retry 1 lần
        if (error.response && error.response.status === 419) {
          console.log('[PriyoClient] CSRF token expired, re-initializing...');
          await this.initialize();
          
          requestData._token = this.csrfToken;
          requestHeaders.cookie = this.getCookieString();
          
          response = await axios.post(
            requestUrl,
            requestData,
            { ...requestOptions, headers: requestHeaders }
          );
          console.log('[PriyoClient] Retry successful, status:', response.status);
        } else {
          throw error;
        }
      }
      
      const responseTime = Date.now() - startTime;
      this.proxyStats.totalResponseTime += responseTime;
      this.proxyStats.successfulRequests++;

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

      // Update snapshots từ response
      if (response.data && response.data.components) {
        this.updateSnapshotsFromResponse(response.data.components);
        
        // Xử lý redirect nếu có
        const component = response.data.components[0];
        if (component && component.effects && component.effects.redirect) {
          // Có redirect, fetch lại HTML để update snapshots
          await this.fetchAndUpdateSnapshots(component.effects.redirect, { skipActions: true });
        }
      }

      return response.data;
    } catch (error) {
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
      
      throw error;
    }
  }

  /**
   * Update snapshots từ server response
   */
  updateSnapshotsFromResponse(components) {
    if (!Array.isArray(components)) {
      console.log('[PriyoClient] updateSnapshotsFromResponse - components is not array');
      return;
    }
    
    console.log('[PriyoClient] ========== UPDATE SNAPSHOTS FROM RESPONSE START ==========');
    console.log('[PriyoClient] Components count:', components.length);
    
    // Log messages trước khi update
    if (this.componentSnapshots.inboxMessage && this.componentSnapshots.inboxMessage.data && this.componentSnapshots.inboxMessage.data.messages) {
      const oldMessages = this.componentSnapshots.inboxMessage.data.messages;
      const oldMessagesCount = Array.isArray(oldMessages[0]) && Array.isArray(oldMessages[0][0]) 
        ? oldMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).length
        : 0;
      console.log('[PriyoClient] Messages count BEFORE update:', oldMessagesCount);
    }
    
    components.forEach((component, index) => {
      if (!component.snapshot) {
        console.log(`[PriyoClient] Component ${index} has no snapshot`);
        return;
      }
      
      try {
        const snapshot = typeof component.snapshot === 'string' 
          ? JSON.parse(component.snapshot) 
          : component.snapshot;
        
        const componentName = snapshot.memo?.name || 'unknown';
        console.log(`[PriyoClient] Updating snapshot for component: ${componentName}`);
        
        // Update snapshot dựa vào component name
        if (snapshot.memo && snapshot.memo.name === 'themes.components.account-actions') {
          this.componentSnapshots.accountActions = snapshot;
          this._parsedSnapshots.accountActions = snapshot;
          if (snapshot.data && snapshot.data.email) {
            this.currentEmail = snapshot.data.email;
          }
          if (snapshot.data && snapshot.data.emails && Array.isArray(snapshot.data.emails[0])) {
            this.currentEmails = snapshot.data.emails[0];
          }
        } else if (snapshot.memo && snapshot.memo.name === 'themes.components.email-history') {
          this.componentSnapshots.emailHistory = snapshot;
          this._parsedSnapshots.emailHistory = snapshot;
        } else if (snapshot.memo && snapshot.memo.name === 'themes.components.action') {
          this.componentSnapshots.action = snapshot;
          this._parsedSnapshots.action = snapshot;
          if (snapshot.data && snapshot.data.email) {
            this.currentEmail = snapshot.data.email;
          }
        } else if (snapshot.memo && snapshot.memo.name === 'themes.components.inbox-message') {
          // QUAN TRỌNG: Log messages trong snapshot mới
          const newMessages = snapshot.data?.messages;
          const newMessagesCount = Array.isArray(newMessages?.[0]) && Array.isArray(newMessages[0][0]) 
            ? newMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).length
            : 0;
          console.log('[PriyoClient] NEW inbox-message snapshot - Messages count:', newMessagesCount);
          if (newMessagesCount > 0) {
            console.log('[PriyoClient] NEW inbox-message snapshot - Messages IDs:', 
              Array.isArray(newMessages[0]) && Array.isArray(newMessages[0][0])
                ? newMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).map(m => m.id)
                : []);
          }
          
          this.componentSnapshots.inboxMessage = snapshot;
          this._parsedSnapshots.inboxMessage = snapshot;
          if (snapshot.data && snapshot.data.email) {
            this.currentEmail = snapshot.data.email;
          }
          if (snapshot.data && snapshot.data.emails && Array.isArray(snapshot.data.emails[0])) {
            this.currentEmails = snapshot.data.emails[0];
          }
          
          // Log messages sau khi update
          const updatedMessages = this.componentSnapshots.inboxMessage.data?.messages;
          const updatedMessagesCount = Array.isArray(updatedMessages?.[0]) && Array.isArray(updatedMessages[0][0]) 
            ? updatedMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).length
            : 0;
          console.log('[PriyoClient] Messages count AFTER update:', updatedMessagesCount);
        } else if (snapshot.memo && snapshot.memo.name === 'themes.components.change-account') {
          this.componentSnapshots.changeAccount = snapshot;
          this._parsedSnapshots.changeAccount = snapshot;
        } else if (snapshot.memo && snapshot.memo.name === 'themes.components.random-account') {
          this.componentSnapshots.randomAccount = snapshot;
          this._parsedSnapshots.randomAccount = snapshot;
        } else if (snapshot.memo && snapshot.memo.name === 'themes.components.create-account') {
          this.componentSnapshots.createAccount = snapshot;
          this._parsedSnapshots.createAccount = snapshot;
        }
      } catch (e) {
        console.error(`[PriyoClient] Error parsing snapshot for component ${index}:`, e.message);
      }
    });
    
    console.log('[PriyoClient] ========== UPDATE SNAPSHOTS FROM RESPONSE END ==========');
  }

  /**
   * Lấy snapshot cho component
   */
  getSnapshot(componentName, emailOverride = null, emailsOverride = null) {
    let snapshot = null;
    
    if (componentName === 'themes.components.account-actions' && this.componentSnapshots.accountActions) {
      if (!this._parsedSnapshots.accountActions || 
          this._parsedSnapshots.accountActions.memo?.id !== this.componentSnapshots.accountActions.memo?.id) {
        this._parsedSnapshots.accountActions = JSON.parse(JSON.stringify(this.componentSnapshots.accountActions));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.accountActions));
      
      if (emailOverride !== null && emailOverride !== undefined) {
        snapshot.data.email = emailOverride || null;
      }
      
      if (emailsOverride !== null && emailsOverride !== undefined && emailsOverride.length > 0) {
        snapshot.data.emails = [emailsOverride, { s: 'arr' }];
      }
      
      return JSON.stringify(snapshot);
    } else if (componentName === 'themes.components.inbox-message' && this.componentSnapshots.inboxMessage) {
      if (!this._parsedSnapshots.inboxMessage || 
          this._parsedSnapshots.inboxMessage.memo?.id !== this.componentSnapshots.inboxMessage.memo?.id) {
        this._parsedSnapshots.inboxMessage = JSON.parse(JSON.stringify(this.componentSnapshots.inboxMessage));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.inboxMessage));
      
      if (emailOverride !== null && emailOverride !== undefined) {
        snapshot.data.email = emailOverride || null;
      }
      
      return JSON.stringify(snapshot);
    } else if (componentName === 'themes.components.action' && this.componentSnapshots.action) {
      if (!this._parsedSnapshots.action || 
          this._parsedSnapshots.action.memo?.id !== this.componentSnapshots.action.memo?.id) {
        this._parsedSnapshots.action = JSON.parse(JSON.stringify(this.componentSnapshots.action));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.action));
      
      if (emailOverride !== null && emailOverride !== undefined) {
        snapshot.data.email = emailOverride || null;
      }
      
      return JSON.stringify(snapshot);
    } else if (componentName === 'themes.components.change-account' && this.componentSnapshots.changeAccount) {
      if (!this._parsedSnapshots.changeAccount || 
          this._parsedSnapshots.changeAccount.memo?.id !== this.componentSnapshots.changeAccount.memo?.id) {
        this._parsedSnapshots.changeAccount = JSON.parse(JSON.stringify(this.componentSnapshots.changeAccount));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.changeAccount));
      
      return JSON.stringify(snapshot);
    } else if (componentName === 'themes.components.random-account' && this.componentSnapshots.randomAccount) {
      if (!this._parsedSnapshots.randomAccount || 
          this._parsedSnapshots.randomAccount.memo?.id !== this.componentSnapshots.randomAccount.memo?.id) {
        this._parsedSnapshots.randomAccount = JSON.parse(JSON.stringify(this.componentSnapshots.randomAccount));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.randomAccount));
      
      return JSON.stringify(snapshot);
    } else if (componentName === 'themes.components.create-account' && this.componentSnapshots.createAccount) {
      if (!this._parsedSnapshots.createAccount || 
          this._parsedSnapshots.createAccount.memo?.id !== this.componentSnapshots.createAccount.memo?.id) {
        this._parsedSnapshots.createAccount = JSON.parse(JSON.stringify(this.componentSnapshots.createAccount));
      }
      snapshot = JSON.parse(JSON.stringify(this._parsedSnapshots.createAccount));
      
      return JSON.stringify(snapshot);
    }
    
    return this.createDefaultSnapshot(componentName, emailOverride, emailsOverride);
  }

  /**
   * Tạo snapshot mặc định cho component
   */
  createDefaultSnapshot(componentName, email = null, emails = []) {
    const timestamp = Date.now();
    const id = this.generateId();

    if (componentName === 'themes.components.account-actions') {
      return JSON.stringify({
        data: {
          email: email || '',
          emails: [emails, { s: 'arr' }],
          avatar: email ? email.charAt(0).toUpperCase() : 'U',
          emailExists: false
        },
        memo: {
          id: id,
          name: 'themes.components.account-actions',
          path: 'vi',
          method: 'GET',
          children: {},
          scripts: [],
          assets: [],
          errors: [],
          locale: 'vi'
        },
        checksum: this.generateChecksum()
      });
    } else if (componentName === 'themes.components.inbox-message') {
      return JSON.stringify({
        data: {
          messages: [[], { s: 'arr' }],
          deleted: [[], { s: 'arr' }],
          error: '',
          email: email || '',
          emails: [emails, { s: 'arr' }],
          emailExists: false,
          overflow: false,
          appPage: true,
          paginators: [[], { s: 'arr' }]
        },
        memo: {
          id: id,
          name: 'themes.components.inbox-message',
          path: 'vi',
          method: 'GET',
          children: [],
          scripts: [],
          assets: [],
          errors: [],
          locale: 'vi'
        },
        checksum: this.generateChecksum()
      });
    } else if (componentName === 'themes.components.action') {
      return JSON.stringify({
        data: {
          email: email || '',
          emails: [emails, { s: 'arr' }],
          emailExists: false
        },
        memo: {
          id: id,
          name: 'themes.components.action',
          path: 'vi',
          method: 'GET',
          children: {},
          scripts: [],
          assets: [],
          errors: [],
          locale: 'vi'
        },
        checksum: this.generateChecksum()
      });
    } else if (componentName === 'themes.components.change-account') {
      return JSON.stringify({
        data: {
          username: '',
          domain: '',
          domains: [[], { s: 'arr' }]
        },
        memo: {
          id: id,
          name: 'themes.components.change-account',
          path: 'vi',
          method: 'GET',
          children: [],
          scripts: [],
          assets: [],
          errors: [],
          locale: 'vi'
        },
        checksum: this.generateChecksum()
      });
    } else if (componentName === 'themes.components.random-account') {
      return JSON.stringify({
        data: {
          email: null
        },
        memo: {
          id: id,
          name: 'themes.components.random-account',
          path: 'vi',
          method: 'GET',
          children: [],
          scripts: [],
          assets: [],
          errors: [],
          locale: 'vi'
        },
        checksum: this.generateChecksum()
      });
    } else if (componentName === 'themes.components.create-account') {
      return JSON.stringify({
        data: {
          username: '',
          domain: '',
          password: '',
          recoveryMail: '',
          domains: [[], { s: 'arr' }]
        },
        memo: {
          id: id,
          name: 'themes.components.create-account',
          path: 'vi',
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
   * Generate checksum giả
   */
  generateChecksum() {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  /**
   * Tạo email với username và domain
   */
  async createEmail(username, domain) {
    try {
      if (!this.componentSnapshots.createAccount) {
        await this.initialize();
      }

      const snapshot = this.getSnapshot('themes.components.create-account');
      
      const payload = {
        components: [{
          snapshot: snapshot,
          updates: {
            username: username || '',
            domain: domain || ''
          },
          calls: [{
            path: '',
            method: 'createEmailAddress',
            params: []
          }]
        }]
      };

      const response = await this.sendRequest(payload);
      
      // Nếu có redirect, fetch lại để lấy email mới
      if (response && response.components && response.components[0] && response.components[0].effects && response.components[0].effects.redirect) {
        await this.fetchAndUpdateSnapshots(response.components[0].effects.redirect, { skipActions: true });
      }

      // Lấy email từ snapshot sau khi tạo
      const email = this.currentEmail;
      
      if (email) {
        return {
          success: true,
          email: email
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Lỗi tạo email'
      };
    }
  }

  /**
   * Tạo email random
   */
  async createRandomEmail() {
    try {
      if (!this.componentSnapshots.randomAccount) {
        await this.initialize();
      }

      const snapshot = this.getSnapshot('themes.components.random-account');
      
      const payload = {
        components: [{
          snapshot: snapshot,
          updates: {},
          calls: [{
            path: '',
            method: 'random',
            params: []
          }]
        }]
      };

      const response = await this.sendRequest(payload);
      
      // Nếu có redirect, fetch lại để lấy email mới
      if (response && response.components && response.components[0] && response.components[0].effects && response.components[0].effects.redirect) {
        await this.fetchAndUpdateSnapshots(response.components[0].effects.redirect, { skipActions: true });
      }

      // Lấy email từ snapshot sau khi tạo
      const email = this.currentEmail;
      
      if (email) {
        return {
          success: true,
          email: email
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email random'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Lỗi tạo email random'
      };
    }
  }

  /**
   * Sync email và fetch messages trong 1 request (giống TMail)
   * Quan trọng: Gộp 2 operations để đảm bảo server có đủ context
   */
  async syncEmailAndFetchMessages(email) {
    try {
      console.log('[PriyoClient] ========== SYNC EMAIL AND FETCH MESSAGES START ==========');
      console.log('[PriyoClient] Email to sync:', email);
      
      if (!this.componentSnapshots.inboxMessage) {
        console.log('[PriyoClient] Snapshots not initialized, initializing...');
        await this.initialize();
      }

      if (!this.componentSnapshots.inboxMessage) {
        console.log('[PriyoClient] InboxMessage snapshot not available');
        this.currentEmail = email;
        return { 
          success: false, 
          error: 'Snapshot not available',
          messages: [],
          count: 0
        };
      }

      // Lấy snapshot (không override email để giữ checksum)
      // Giữ nguyên messages trong snapshot để server tự so sánh và trả về messages mới
      const snapshot = this.getSnapshot('themes.components.inbox-message', null);
      
      // Gộp syncEmail + fetchMessages trong 1 request (giống TMail)
      const payload = {
        components: [{
          snapshot: snapshot,
          updates: {},
          calls: [
            {
              path: '',
              method: '__dispatch',
              params: ['syncEmail', { email: email }]
            },
            {
              path: '',
              method: '__dispatch',
              params: ['fetchMessages', {}]
            }
          ]
        }]
      };

      console.log('[PriyoClient] Sending syncEmail + fetchMessages in one request...');
      const response = await this.sendRequest(payload);
      
      // Update snapshot từ response
      if (response && response.components) {
        this.updateSnapshotsFromResponse(response.components);
      }
      
      // Parse messages từ snapshot sau khi sync
      // QUAN TRỌNG: Server có thể chỉ trả về messages mới trong response
      // Nên cần merge với messages cũ từ snapshot trước đó
      let newMessages = [];
      if (this.componentSnapshots.inboxMessage && this.componentSnapshots.inboxMessage.data && this.componentSnapshots.inboxMessage.data.messages) {
        newMessages = this.parseMessagesFromSnapshot(this.componentSnapshots.inboxMessage.data.messages);
        console.log('[PriyoClient] New messages from syncEmailAndFetchMessages:', newMessages.length);
      }
      
      // Lưu messages vào snapshot để lần fetch sau có thể merge
      // (messages đã được update trong updateSnapshotsFromResponse rồi)
      
      this.currentEmail = email;
      console.log('[PriyoClient] Messages count after sync:', newMessages.length);
      console.log('[PriyoClient] ========== SYNC EMAIL AND FETCH MESSAGES END ==========');
      
      return {
        success: true,
        messages: this.formatMessages(newMessages),
        count: newMessages.length
      };
    } catch (error) {
      console.error('[PriyoClient] syncEmailAndFetchMessages error:', error.message);
      this.currentEmail = email;
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Sync email (đồng bộ email với server)
   * Chỉ sync với inbox-message component để tránh lỗi 500
   * NOTE: Nên dùng syncEmailAndFetchMessages() thay vì method này
   */
  async syncEmail(email) {
    try {
      console.log('[PriyoClient] ========== SYNC EMAIL START ==========');
      console.log('[PriyoClient] Email to sync:', email);
      
      // Log messages trước khi sync
      if (this.componentSnapshots.inboxMessage && this.componentSnapshots.inboxMessage.data && this.componentSnapshots.inboxMessage.data.messages) {
        const oldMessages = this.componentSnapshots.inboxMessage.data.messages;
        const oldMessagesCount = Array.isArray(oldMessages[0]) && Array.isArray(oldMessages[0][0]) 
          ? oldMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).length
          : 0;
        console.log('[PriyoClient] Messages count BEFORE sync:', oldMessagesCount);
      }
      
      if (!this.componentSnapshots.inboxMessage) {
        console.log('[PriyoClient] Snapshots not initialized, initializing...');
        await this.initialize();
      }

      // Chỉ sync với inbox-message component (đủ để server biết email nào đang dùng)
      if (!this.componentSnapshots.inboxMessage) {
        console.log('[PriyoClient] InboxMessage snapshot not available, skipping sync');
        this.currentEmail = email;
        console.log('[PriyoClient] ========== SYNC EMAIL END (NO SNAPSHOT) ==========');
        return { success: true, message: 'Email set (no sync needed)' };
      }

      // QUAN TRỌNG: Không override email trong snapshot để giữ checksum đúng
      // Chỉ dùng snapshot mới từ initialize() và dispatch event syncEmail
      // Server sẽ tự update email sau khi nhận event
      const snapshot = this.getSnapshot('themes.components.inbox-message', null); // Không override email
      console.log('[PriyoClient] Snapshot for sync length:', snapshot ? snapshot.length : 0);
      
      // Log snapshot để debug
      try {
        const snapshotObj = JSON.parse(snapshot);
        console.log('[PriyoClient] Snapshot for sync:', {
          id: snapshotObj.memo?.id,
          name: snapshotObj.memo?.name,
          email: snapshotObj.data?.email,
          hasMessages: !!(snapshotObj.data?.messages),
          messagesCount: Array.isArray(snapshotObj.data?.messages?.[0]) && Array.isArray(snapshotObj.data.messages[0][0])
            ? snapshotObj.data.messages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).length
            : 0,
          checksum: snapshotObj.checksum?.substring(0, 20) + '...'
        });
      } catch (e) {
        console.log('[PriyoClient] Cannot parse snapshot for logging:', e.message);
      }
      
      const payload = {
        components: [{
          snapshot: snapshot,
          updates: {},
          calls: [{
            path: '',
            method: '__dispatch',
            params: ['syncEmail', { email: email }]
          }]
        }]
      };
      
      console.log('[PriyoClient] Payload for syncEmail:', JSON.stringify({
        hasSnapshot: !!payload.components[0].snapshot,
        snapshotLength: payload.components[0].snapshot?.length || 0,
        calls: payload.components[0].calls,
        emailInParams: payload.components[0].calls[0].params[1].email
      }));

      console.log('[PriyoClient] Sending syncEmail request (inbox-message only)...');
      const syncResponse = await this.sendRequest(payload);
      
      // Update snapshot sau khi sync
      if (syncResponse && syncResponse.components && syncResponse.components[0] && syncResponse.components[0].snapshot) {
        this.updateSnapshotsFromResponse(syncResponse.components);
        console.log('[PriyoClient] Snapshot updated after syncEmail');
      }
      
      // Log messages sau khi sync
      if (this.componentSnapshots.inboxMessage && this.componentSnapshots.inboxMessage.data && this.componentSnapshots.inboxMessage.data.messages) {
        const newMessages = this.componentSnapshots.inboxMessage.data.messages;
        const newMessagesCount = Array.isArray(newMessages[0]) && Array.isArray(newMessages[0][0]) 
          ? newMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).length
          : 0;
        console.log('[PriyoClient] Messages count AFTER sync:', newMessagesCount);
        if (newMessagesCount > 0) {
          console.log('[PriyoClient] Messages IDs AFTER sync:', 
            Array.isArray(newMessages[0]) && Array.isArray(newMessages[0][0])
              ? newMessages[0][0].filter(m => m && typeof m === 'object' && !m.s && (m.id || m.subject)).map(m => m.id)
              : []);
        } else {
          console.log('[PriyoClient] WARNING: Messages count is 0 after sync!');
        }
      }
      
      this.currentEmail = email;
      console.log('[PriyoClient] Email synced successfully');
      console.log('[PriyoClient] ========== SYNC EMAIL END ==========');
      
      return { success: true, message: 'Email synced successfully' };
    } catch (error) {
      console.error('[PriyoClient] syncEmail error:', error.message);
      console.error('[PriyoClient] Error stack:', error.stack);
      // Không throw error, chỉ log và return false để fetchMessages vẫn có thể tiếp tục
      this.currentEmail = email; // Vẫn set email để fetchMessages có thể dùng
      console.log('[PriyoClient] ========== SYNC EMAIL END (WITH ERROR) ==========');
      return {
        success: false,
        error: error.message || 'Lỗi sync email'
      };
    }
  }

  /**
   * Fetch messages (lấy danh sách thư)
   */
  async fetchMessages() {
    try {
      console.log('[PriyoClient] fetchMessages - Starting...');
      console.log('[PriyoClient] Current email:', this.currentEmail);
      console.log('[PriyoClient] InboxMessage snapshot exists:', !!this.componentSnapshots.inboxMessage);
      
      if (!this.componentSnapshots.inboxMessage) {
        console.log('[PriyoClient] InboxMessage snapshot not found, initializing...');
        await this.initialize();
      }

      if (!this.currentEmail) {
        console.log('[PriyoClient] No current email, returning empty messages');
        return {
          success: true,
          messages: [],
          count: 0
        };
      }

      // Lấy snapshot (giữ nguyên messages để server tự so sánh và trả về messages mới)
      const snapshot = this.getSnapshot('themes.components.inbox-message', this.currentEmail);
      console.log('[PriyoClient] Snapshot length:', snapshot ? snapshot.length : 0);
      
      const payload = {
        components: [{
          snapshot: snapshot,
          updates: {},
          calls: [{
            path: '',
            method: '__dispatch',
            params: ['fetchMessages', {}]
          }]
        }]
      };

      // QUAN TRỌNG: Lưu messages cũ từ snapshot trước khi fetch
      // Để merge với messages mới từ response (server chỉ trả về messages mới)
      let oldMessages = [];
      if (this.componentSnapshots.inboxMessage && 
          this.componentSnapshots.inboxMessage.data && 
          this.componentSnapshots.inboxMessage.data.messages) {
        try {
          oldMessages = this.parseMessagesFromSnapshot(this.componentSnapshots.inboxMessage.data.messages);
          console.log('[PriyoClient] Old messages count before fetch:', oldMessages.length);
          if (oldMessages.length > 0) {
            console.log('[PriyoClient] Old messages IDs:', oldMessages.map(m => m.id || 'no-id'));
          }
        } catch (e) {
          console.log('[PriyoClient] Error parsing old messages:', e.message);
        }
      }
      
      console.log('[PriyoClient] Sending fetchMessages request...');
      const response = await this.sendRequest(payload);
      console.log('[PriyoClient] Response received:', {
        hasComponents: !!(response && response.components),
        componentsCount: response?.components?.length || 0,
        hasEffects: !!(response?.components?.[0]?.effects),
        hasHtml: !!(response?.components?.[0]?.effects?.html),
        hasSnapshot: !!(response?.components?.[0]?.snapshot)
      });
      
      // Update snapshot từ response (sendRequest đã update rồi, nhưng đảm bảo chắc chắn)
      if (response && response.components) {
        this.updateSnapshotsFromResponse(response.components);
      }
      
      // QUAN TRỌNG: Messages nằm trong snapshot của response, không phải HTML
      // Cấu trúc: snapshot.data.messages = [[[{message1}, {message2}, ...], {s: "arr"}], {s: "arr"}]
      // QUAN TRỌNG: Server chỉ trả về messages mới (chưa có trong snapshot gửi lên)
      // Nên cần merge với messages cũ để có đầy đủ messages
      if (response && response.components && response.components[0] && response.components[0].snapshot) {
        try {
          const snapshotData = typeof response.components[0].snapshot === 'string' 
            ? JSON.parse(response.components[0].snapshot) 
            : response.components[0].snapshot;
          
          console.log('[PriyoClient] Parsing messages from snapshot...');
          console.log('[PriyoClient] Snapshot data keys:', snapshotData.data ? Object.keys(snapshotData.data) : 'no data');
          
          // Log cấu trúc messages để debug
          if (snapshotData.data && snapshotData.data.messages) {
            console.log('[PriyoClient] Messages structure:', {
              type: typeof snapshotData.data.messages,
              isArray: Array.isArray(snapshotData.data.messages),
              length: snapshotData.data.messages.length,
              firstLevel: snapshotData.data.messages[0] ? {
                type: typeof snapshotData.data.messages[0],
                isArray: Array.isArray(snapshotData.data.messages[0]),
                length: Array.isArray(snapshotData.data.messages[0]) ? snapshotData.data.messages[0].length : 'N/A'
              } : null
            });
            
            // Log toàn bộ cấu trúc messages (giới hạn độ sâu để tránh quá dài)
            try {
              const messagesStr = JSON.stringify(snapshotData.data.messages, null, 2);
              console.log('[PriyoClient] Full messages structure (first 500 chars):', messagesStr.substring(0, 500));
              if (messagesStr.length > 500) {
                console.log('[PriyoClient] ... (truncated, total length:', messagesStr.length, 'chars)');
              }
            } catch (e) {
              console.log('[PriyoClient] Cannot stringify messages:', e.message);
            }
            
            // Log một phần của messages để xem cấu trúc
            if (Array.isArray(snapshotData.data.messages[0]) && snapshotData.data.messages[0].length > 0) {
              console.log('[PriyoClient] First level first item:', {
                type: typeof snapshotData.data.messages[0][0],
                isArray: Array.isArray(snapshotData.data.messages[0][0]),
                keys: snapshotData.data.messages[0][0] && typeof snapshotData.data.messages[0][0] === 'object' && !Array.isArray(snapshotData.data.messages[0][0])
                  ? Object.keys(snapshotData.data.messages[0][0]).slice(0, 5)
                  : 'N/A'
              });
            }
          }
          
          if (snapshotData.data && snapshotData.data.messages) {
            // Cấu trúc: messages = [[[{msg1}, {msg2}], {s: "arr"}], {s: "arr"}]
            // messages[0] = [[{msg1}, {msg2}], {s: "arr"}]
            // messages[0][0] = [{msg1}, {msg2}] - đây là array các message objects
            let messagesArray = [];
            
            console.log('[PriyoClient] Raw messages structure:', JSON.stringify({
              isArray: Array.isArray(snapshotData.data.messages),
              length: snapshotData.data.messages.length,
              hasFirstLevel: !!snapshotData.data.messages[0],
              firstLevelIsArray: Array.isArray(snapshotData.data.messages[0]),
              firstLevelLength: Array.isArray(snapshotData.data.messages[0]) ? snapshotData.data.messages[0].length : 'N/A',
              hasSecondLevel: Array.isArray(snapshotData.data.messages[0]) && snapshotData.data.messages[0].length > 0 && Array.isArray(snapshotData.data.messages[0][0]),
              secondLevelLength: Array.isArray(snapshotData.data.messages[0]) && Array.isArray(snapshotData.data.messages[0][0]) ? snapshotData.data.messages[0][0].length : 'N/A'
            }));
            
            // Kiểm tra cấu trúc: messages[0][0] phải là array các message objects
            if (Array.isArray(snapshotData.data.messages[0]) && 
                snapshotData.data.messages[0].length > 0 && 
                Array.isArray(snapshotData.data.messages[0][0])) {
              // messages[0][0] chính là array các message objects
              const messagesData = snapshotData.data.messages[0][0];
              
              // Filter để lấy các message objects (bỏ qua {s: "arr"} và các metadata objects)
              messagesArray = messagesData.filter(msg => {
                // Message object phải có id hoặc subject, và không phải là metadata object ({s: "arr"})
                return msg && 
                       typeof msg === 'object' && 
                       !msg.s && 
                       (msg.id || msg.subject || msg.sender_name || msg.sender_email);
              });
              
              console.log('[PriyoClient] Found messages array from messages[0][0], length:', messagesArray.length);
              
              if (messagesArray.length > 0) {
                console.log('[PriyoClient] Messages IDs:', messagesArray.map(m => m.id || 'no-id'));
              }
            } else if (Array.isArray(snapshotData.data.messages[0]) && snapshotData.data.messages[0].length > 0) {
              // Fallback: nếu messages[0][0] không phải array, thử lấy từ messages[0]
              const firstLevel = snapshotData.data.messages[0];
              
              // Tìm phần tử đầu tiên là array (bỏ qua {s: "arr"})
              for (const item of firstLevel) {
                if (Array.isArray(item)) {
                  // Đây là array các messages
                  messagesArray = item.filter(msg => msg && typeof msg === 'object' && !msg.s && (msg.id || msg.subject));
                  console.log('[PriyoClient] Found messages array in first level, length:', messagesArray.length);
                  break;
                } else if (item && typeof item === 'object' && !item.s && (item.id || item.subject)) {
                  // Đây là message object trực tiếp
                  messagesArray.push(item);
                }
              }
              
              // Nếu vẫn chưa có, thử lấy tất cả objects (bỏ qua {s: "arr"})
              if (messagesArray.length === 0) {
                messagesArray = firstLevel.filter(item => item && typeof item === 'object' && !item.s && (item.id || item.subject));
                console.log('[PriyoClient] Filtered messages from first level, length:', messagesArray.length);
              }
            } else {
              console.log('[PriyoClient] messages[0] is empty or not array');
            }
            
            console.log('[PriyoClient] New messages from response:', messagesArray.length);
            if (messagesArray.length > 0) {
              console.log('[PriyoClient] New messages IDs:', messagesArray.map(m => m.id || 'no-id'));
            }
            
            // QUAN TRỌNG: Merge messages cũ với messages mới
            // Server chỉ trả về messages mới (chưa có trong snapshot gửi lên)
            // Nên cần merge để có đầy đủ messages
            const allMessagesMap = new Map();
            
            // Thêm messages cũ vào map (key = message ID)
            oldMessages.forEach(msg => {
              const msgId = msg.id || msg.subject || msg.sender_email;
              if (msgId) {
                allMessagesMap.set(msgId, msg);
              }
            });
            
            // Thêm/update messages mới vào map (messages mới sẽ override messages cũ nếu cùng ID)
            messagesArray.forEach(msg => {
              const msgId = msg.id || msg.subject || msg.sender_email;
              if (msgId) {
                allMessagesMap.set(msgId, msg);
              }
            });
            
            // Convert map về array và sort theo timestamp (mới nhất trước)
            const allMessages = Array.from(allMessagesMap.values());
            allMessages.sort((a, b) => {
              const timeA = a.timestamp || (Array.isArray(a.timestamp) ? a.timestamp[0] : 0) || 0;
              const timeB = b.timestamp || (Array.isArray(b.timestamp) ? b.timestamp[0] : 0) || 0;
              return timeB - timeA; // Mới nhất trước
            });
            
            console.log('[PriyoClient] Merged messages count (old + new):', allMessages.length);
            if (allMessages.length > 0) {
              console.log('[PriyoClient] All merged messages IDs:', allMessages.map(m => m.id || 'no-id'));
            }
            
            const formatted = this.formatMessages(allMessages);
            console.log('[PriyoClient] Formatted messages count:', formatted.length);
            
            return {
              success: true,
              messages: formatted,
              count: formatted.length
            };
          } else {
            console.log('[PriyoClient] No messages in snapshot.data.messages');
          }
        } catch (e) {
          console.error('[PriyoClient] Error parsing snapshot:', e.message);
          console.error('[PriyoClient] Error stack:', e.stack);
        }
      }
      
      // Fallback: Thử parse từ HTML nếu không có snapshot
      if (response && response.components && response.components[0] && response.components[0].effects && response.components[0].effects.html) {
        const html = response.components[0].effects.html;
        console.log('[PriyoClient] Fallback: Parsing from HTML, length:', html.length);
        const messages = this.parseMessagesFromHTML(html);
        console.log('[PriyoClient] Parsed messages from HTML count:', messages.length);
        
        if (messages.length > 0) {
          return {
            success: true,
            messages: messages,
            count: messages.length
          };
        }
      }

      // Nếu không có HTML, lấy từ snapshot đã lưu
      if (this.componentSnapshots.inboxMessage && this.componentSnapshots.inboxMessage.data && this.componentSnapshots.inboxMessage.data.messages) {
        const messages = this.componentSnapshots.inboxMessage.data.messages[0] || [];
        console.log('[PriyoClient] Using cached snapshot messages, count:', messages.length);
        return {
          success: true,
          messages: this.formatMessages(messages),
          count: messages.length
        };
      }

      console.log('[PriyoClient] No messages found, returning empty');
      return {
        success: true,
        messages: [],
        count: 0
      };
    } catch (error) {
      console.error('[PriyoClient] fetchMessages error:', error.message);
      console.error('[PriyoClient] Error stack:', error.stack);
      return {
        success: false,
        error: error.message || 'Lỗi fetch messages',
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Parse messages từ snapshot data (messages field)
   * Cấu trúc: messages = [[[{msg1}, {msg2}], {s: "arr"}], {s: "arr"}]
   */
  parseMessagesFromSnapshot(messagesData) {
    if (!messagesData) {
      return [];
    }
    
    let messagesArray = [];
    
    // Kiểm tra cấu trúc: messages[0][0] phải là array các message objects
    if (Array.isArray(messagesData[0]) && 
        messagesData[0].length > 0 && 
        Array.isArray(messagesData[0][0])) {
      // messages[0][0] chính là array các message objects
      const messages = messagesData[0][0];
      
      // Filter để lấy các message objects (bỏ qua {s: "arr"} và các metadata objects)
      messagesArray = messages.filter(msg => {
        return msg && 
               typeof msg === 'object' && 
               !msg.s && 
               (msg.id || msg.subject || msg.sender_name || msg.sender_email);
      });
    } else if (Array.isArray(messagesData[0]) && messagesData[0].length > 0) {
      // Fallback: nếu messages[0][0] không phải array, thử lấy từ messages[0]
      const firstLevel = messagesData[0];
      
      // Tìm phần tử đầu tiên là array (bỏ qua {s: "arr"})
      for (const item of firstLevel) {
        if (Array.isArray(item)) {
          // Đây là array các messages
          messagesArray = item.filter(msg => msg && typeof msg === 'object' && !msg.s && (msg.id || msg.subject));
          break;
        } else if (item && typeof item === 'object' && !item.s && (item.id || item.subject)) {
          // Đây là message object trực tiếp
          messagesArray.push(item);
        }
      }
      
      // Nếu vẫn chưa có, thử lấy tất cả objects (bỏ qua {s: "arr"})
      if (messagesArray.length === 0) {
        messagesArray = firstLevel.filter(item => item && typeof item === 'object' && !item.s && (item.id || item.subject));
      }
    }
    
    return messagesArray;
  }

  /**
   * Parse messages từ HTML
   */
  parseMessagesFromHTML(html) {
    try {
      const $ = cheerio.load(html);
      const messages = [];
      
      // Tìm tất cả message items trong HTML
      // Priyo có thể có cấu trúc HTML khác, cần điều chỉnh dựa trên HTML thực tế
      $('[data-message-id], .message-item, tr[data-email]').each((i, el) => {
        const $el = $(el);
        const messageId = $el.attr('data-message-id') || $el.attr('wire:id') || `msg-${i}`;
        const subject = $el.find('.subject, [data-subject]').text().trim() || 'Không có tiêu đề';
        const sender = $el.find('.sender, [data-sender]').text().trim() || 'Không rõ';
        const date = $el.find('.date, [data-date]').text().trim() || null;
        
        messages.push({
          id: messageId,
          subject: subject,
          sender_name: sender,
          sender_email: sender.includes('@') ? sender : '',
          date: date,
          datediff: null,
          timestamp: null,
          content: '',
          content_raw: '',
          attachments: []
        });
      });
      
      return messages;
    } catch (error) {
      return [];
    }
  }

  /**
   * Format messages từ snapshot data
   */
  formatMessages(messages) {
    if (!Array.isArray(messages)) {
      console.log('[PriyoClient] formatMessages: messages is not array:', typeof messages);
      return [];
    }
    
    console.log('[PriyoClient] formatMessages: Processing', messages.length, 'messages');
    
    return messages.map((msg, index) => {
      // Parse timestamp nếu là array format: ["2025-12-07T13:10:18+00:00", {"type":"nativeImmutable","s":"cbn"}]
      let timestamp = null;
      if (msg.timestamp) {
        if (Array.isArray(msg.timestamp) && msg.timestamp[0]) {
          try {
            timestamp = new Date(msg.timestamp[0]).getTime();
          } catch (e) {
            // Ignore
          }
        } else if (typeof msg.timestamp === 'string') {
          try {
            timestamp = new Date(msg.timestamp).getTime();
          } catch (e) {
            // Ignore
          }
        } else if (typeof msg.timestamp === 'number') {
          timestamp = msg.timestamp;
        }
      }
      
      // Parse attachments nếu là array format: [[], {s: "arr"}]
      let attachments = [];
      if (msg.attachments) {
        if (Array.isArray(msg.attachments[0])) {
          attachments = msg.attachments[0];
        } else if (Array.isArray(msg.attachments)) {
          attachments = msg.attachments.filter(a => a && typeof a === 'object' && !a.s);
        }
      }
      
      const formatted = {
        id: msg.id || `msg-${index}`,
        subject: msg.subject || 'Không có tiêu đề',
        sender_name: msg.sender_name || msg.sender || 'Không rõ',
        sender_email: msg.sender_email || msg.from || '',
        date: msg.date || null,
        datediff: msg.datediff || null,
        timestamp: timestamp,
        content: msg.content || '',
        content_raw: msg.content || '',
        html: msg.content || '',
        attachments: attachments
      };
      
      if (index === 0) {
        console.log('[PriyoClient] First formatted message:', {
          id: formatted.id,
          subject: formatted.subject,
          sender: formatted.sender_name,
          hasContent: !!formatted.content,
          contentLength: formatted.content ? formatted.content.length : 0
        });
      }
      
      return formatted;
    });
  }

  /**
   * Xóa email
   */
  async deleteEmail() {
    try {
      if (!this.componentSnapshots.action) {
        await this.initialize();
      }

      const snapshot = this.getSnapshot('themes.components.action', this.currentEmail);
      
      const payload = {
        components: [{
          snapshot: snapshot,
          updates: {},
          calls: [{
            path: '',
            method: 'deleteEmail',
            params: []
          }]
        }]
      };

      const response = await this.sendRequest(payload);
      
      // Sau khi xóa, tạo email random mới
      const randomResult = await this.createRandomEmail();
      
      return {
        success: true,
        email: randomResult.email || null,
        message: 'Email đã được xóa và tạo email mới'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Lỗi xóa email'
      };
    }
  }

  /**
   * Lấy danh sách domains
   */
  getDomains() {
    try {
      // Lấy từ snapshot create-account hoặc change-account
      // Cấu trúc: domains = [[[{domain: "..."}, {s: "arr"}], ...], {s: "arr"}]
      // domains[0] là array các array, mỗi array có dạng [{domain: "..."}, {s: "arr"}]
      let domains = [];
      
      if (this.componentSnapshots.createAccount && this.componentSnapshots.createAccount.data && this.componentSnapshots.createAccount.data.domains) {
        const domainsData = this.componentSnapshots.createAccount.data.domains[0];
        if (Array.isArray(domainsData)) {
          // domainsData là array các array: [[{domain: "..."}, {s: "arr"}], ...]
          domains = domainsData
            .map(d => {
              // d là array [{domain: "..."}, {s: "arr"}]
              if (Array.isArray(d) && d[0] && typeof d[0] === 'object' && d[0].domain) {
                return d[0].domain;
              }
              // Fallback: nếu d là object trực tiếp
              if (typeof d === 'object' && d.domain && !d.s) {
                return d.domain;
              }
              // Fallback: nếu d là string
              if (typeof d === 'string') {
                return d;
              }
              return null;
            })
            .filter(Boolean);
        }
      } else if (this.componentSnapshots.changeAccount && this.componentSnapshots.changeAccount.data && this.componentSnapshots.changeAccount.data.domains) {
        const domainsData = this.componentSnapshots.changeAccount.data.domains[0];
        if (Array.isArray(domainsData)) {
          // domainsData là array các array: [[{domain: "..."}, {s: "arr"}], ...]
          domains = domainsData
            .map(d => {
              // d là array [{domain: "..."}, {s: "arr"}]
              if (Array.isArray(d) && d[0] && typeof d[0] === 'object' && d[0].domain) {
                return d[0].domain;
              }
              // Fallback: nếu d là object trực tiếp
              if (typeof d === 'object' && d.domain && !d.s) {
                return d.domain;
              }
              // Fallback: nếu d là string
              if (typeof d === 'string') {
                return d;
              }
              return null;
            })
            .filter(Boolean);
        }
      }
      
      console.log('[PriyoClient] getDomains - Parsed domains count:', domains.length);
      if (domains.length > 0) {
        console.log('[PriyoClient] getDomains - First 3 domains:', domains.slice(0, 3));
      }
      
      // Domains mặc định nếu không lấy được
      if (domains.length === 0) {
        console.log('[PriyoClient] getDomains - No domains found, using defaults');
        domains = [
          'priyo-mail.com',
          'kanonmail.com',
          'auth2fa.com',
          'priyomail.top',
          'priyomail.net',
          'nrehi.com',
          'priyomail.in',
          'bdm.ovh',
          'frm.ovh',
          'idf.ovh',
          'mailp.org',
          'mpk.ovh',
          'oku.ovh',
          'priyo.ovh',
          'sgm.ovh',
          'ukm.ovh',
          'usm.ovh',
          'oky.ovh',
          'genzotp.com',
          'genzmaile.com',
          'resmso.com',
          'mkeya.com',
          'itspid.com',
          'itsbds.com',
          'bdshar.com',
          'priyo.site',
          'idfd.live',
          'tppp.one',
          'tppp.online',
          'teligmail.site',
          '1se.io',
          'priyo.email',
          'priyomail.nl',
          'priyomail.org'
        ];
      }
      
      return domains;
    } catch (error) {
      return [
        'priyo-mail.com',
        'kanonmail.com',
        'auth2fa.com',
        'priyomail.top',
        'priyomail.net'
      ];
    }
  }

  /**
   * Lấy email hiện tại
   */
  getCurrentEmail() {
    return this.currentEmail;
  }

  /**
   * Set email hiện tại
   */
  setCurrentEmail(email) {
    this.currentEmail = email;
  }

  /**
   * Lấy danh sách emails
   */
  getAllEmails() {
    return this.currentEmails.length > 0 ? this.currentEmails : (this.currentEmail ? [this.currentEmail] : []);
  }
}

