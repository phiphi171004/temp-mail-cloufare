import axios from 'axios';
import { CONFIG } from './config.js';

/**
 * MailTemp Client (mailtemp.us)
 * REST API client cho mailtemp.us temporary email service
 */
export class AppleClient {
  constructor() {
    this.baseURL = 'https://mailtemp.us';
    this.token = null;
    this.currentEmail = null;
    this.expiresAt = null;

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
  buildProxyURL(targetUrl) {
    if (!CONFIG.USE_PROXY || !CONFIG.SCRAPERAPI_KEY) {
      return targetUrl;
    }

    const encodedUrl = encodeURIComponent(targetUrl);
    return `${CONFIG.SCRAPERAPI_URL}?api_key=${CONFIG.SCRAPERAPI_KEY}&url=${encodedUrl}`;
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
   * Gửi request với proxy support
   */
  async sendRequest(method, endpoint, data = null) {
    const url = `${this.baseURL}${endpoint}`;
    const startTime = Date.now();

    if (CONFIG.USE_PROXY) {
      this.proxyStats.totalRequests++;
    }

    try {
      let response;
      const targetUrl = this.buildProxyURL(url);

      if (method === 'GET') {
        response = await axios.get(targetUrl, {
          headers: {
            'user-agent': CONFIG.HEADERS['user-agent']
          }
        });
      } else if (method === 'POST') {
        const formData = new URLSearchParams();
        if (data) {
          Object.entries(data).forEach(([key, value]) => {
            formData.append(key, value);
          });
        }

        response = await axios.post(targetUrl, formData, {
          headers: {
            'user-agent': CONFIG.HEADERS['user-agent'],
            'content-type': 'application/x-www-form-urlencoded'
          }
        });
      }

      if (CONFIG.USE_PROXY) {
        const responseTime = Date.now() - startTime;
        this.proxyStats.totalResponseTime += responseTime;
        this.proxyStats.successfulRequests++;
      }

      return response.data;
    } catch (error) {
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

      throw error;
    }
  }

  /**
   * Khởi tạo - fetch domains
   */
  async initialize() {
    try {
      // Fetch domains để cache
      const domains = await this.getDomains();
      console.log('[Apple] Initialized with', domains.length, 'domains');
      return true;
    } catch (error) {
      console.error('[Apple] Initialize error:', error.message);
      return false;
    }
  }

  /**
   * Lấy danh sách domains có sẵn
   */
  async getDomains() {
    try {
      const response = await this.sendRequest('GET', '/api/domains');

      if (response.status === 'success') {
        return response.domains.map(d => d.domain);
      }

      return [];
    } catch (error) {
      console.error('[Apple] Lỗi lấy domains:', error.message);
      return [];
    }
  }

  /**
   * Tạo email ngẫu nhiên
   */
  async createRandomEmail() {
    try {
      const response = await this.sendRequest('POST', '/api/create-session');

      if (response.status === 'success') {
        this.token = response.token;
        this.currentEmail = response.email;
        this.expiresAt = response.expires_at;

        return {
          success: true,
          email: response.email,
          token: response.token,
          expiresAt: response.expires_at
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email'
      };
    } catch (error) {
      console.error('[Apple] Lỗi tạo email ngẫu nhiên:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email với username và domain tùy chỉnh
   */
  async createEmail(username, domain) {
    try {
      // Lấy danh sách domains để tìm domain_id
      const domainsResponse = await this.sendRequest('GET', '/api/domains');

      if (domainsResponse.status !== 'success') {
        return {
          success: false,
          error: 'Không thể lấy danh sách domains'
        };
      }

      const domainObj = domainsResponse.domains.find(d => d.domain === domain);

      if (!domainObj) {
        return {
          success: false,
          error: `Domain ${domain} không tồn tại`
        };
      }

      const response = await this.sendRequest('POST', '/api/create-session', {
        prefix: username,
        domain_id: domainObj.id
      });

      if (response.status === 'success') {
        this.token = response.token;
        this.currentEmail = response.email;
        this.expiresAt = response.expires_at;

        return {
          success: true,
          email: response.email,
          token: response.token,
          expiresAt: response.expires_at
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email'
      };
    } catch (error) {
      console.error('[Apple] Lỗi tạo email:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Lấy email hiện tại
   */
  getCurrentEmail() {
    return this.currentEmail;
  }

  /**
   * Lấy token hiện tại
   */
  getToken() {
    return this.token;
  }

  /**
   * Set token (khi restore từ storage)
   */
  setToken(token, email = null) {
    this.token = token;
    if (email) {
      this.currentEmail = email;
    }
  }

  /**
   * Fetch messages
   */
  async fetchMessages() {
    if (!this.token) {
      return {
        success: false,
        error: 'Token không tồn tại',
        messages: [],
        count: 0
      };
    }

    try {
      const response = await this.sendRequest('GET', `/api/check-mail?token=${this.token}`);

      if (response.status === 'success') {
        const messages = response.messages || [];

        // Transform sang format chuẩn
        const transformedMessages = messages.map(msg => ({
          id: msg.id,
          subject: msg.subject || 'Không có tiêu đề',
          sender_name: msg.sender_name || 'Không rõ',
          sender: msg.sender_name || 'Không rõ',
          sender_email: msg.sender_email || '', // Sẽ có khi gọi read-mail
          date: msg.received_at || new Date().toISOString(),
          body: null, // Cần gọi read-mail để lấy body
          attachments: []
        }));

        return {
          success: true,
          messages: transformedMessages,
          count: transformedMessages.length
        };
      }

      return {
        success: false,
        error: 'Không thể lấy messages',
        messages: [],
        count: 0
      };
    } catch (error) {
      console.error('[Apple] Lỗi fetch messages:', error.message);
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Đọc nội dung message
   */
  async readMessage(messageId) {
    if (!this.token) {
      return {
        success: false,
        error: 'Token không tồn tại'
      };
    }

    try {
      console.log('[Apple] Reading message:', messageId);
      const response = await this.sendRequest('GET', `/api/read-mail?token=${this.token}&id=${messageId}`);

      console.log('[Apple] read-mail response:', JSON.stringify(response, null, 2));

      if (response.status === 'success' && response.message) {
        const msg = response.message;

        return {
          success: true,
          message: {
            id: msg.id,
            subject: msg.subject || 'Không có tiêu đề',
            sender: msg.sender_email || 'Không rõ',
            sender_email: msg.sender_email || '',
            date: msg.received_at || new Date().toISOString(),
            body: msg.body_html || msg.body_text || '',
            body_text: msg.body_text || '',
            body_html: msg.body_html || '',
            attachments: []
          }
        };
      }

      return {
        success: false,
        error: 'Không thể đọc message'
      };
    } catch (error) {
      console.error('[Apple] Lỗi đọc message:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Xóa message
   */
  async deleteMessage(messageId) {
    if (!this.token) {
      return {
        success: false,
        error: 'Token không tồn tại'
      };
    }

    try {
      const response = await this.sendRequest('POST', '/api/delete-mail', {
        token: this.token,
        id: messageId
      });

      if (response.status === 'success') {
        return {
          success: true,
          message: response.message || 'Đã xóa message'
        };
      }

      return {
        success: false,
        error: 'Không thể xóa message'
      };
    } catch (error) {
      console.error('[Apple] Lỗi xóa message:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Sync email - không cần thiết cho Apple API
   */
  async syncEmail(email) {
    return { success: true };
  }

  /**
   * Lấy cookies để lưu (cho reload)
   */
  getCookiesForStorage() {
    return JSON.stringify({
      token: this.token,
      email: this.currentEmail,
      expiresAt: this.expiresAt
    });
  }

  /**
   * Set cookies từ storage (khi reload)
   */
  setCookiesFromStorage(cookiesJson) {
    try {
      const data = JSON.parse(cookiesJson);
      this.token = data.token || null;
      this.currentEmail = data.email || null;
      this.expiresAt = data.expiresAt || null;
      return true;
    } catch (e) {
      return false;
    }
  }
}
