import axios from 'axios';

/**
 * MailIO Client
 * Client kết nối với temp-mail.io (api.internal.temp-mail.io)
 */
export class MailIOClient {
  constructor() {
    this.baseURL = 'https://api.internal.temp-mail.io/api';
    this.domains = [];
    this.currentEmail = null;
    this.currentDomain = null;
    this.token = null; // Token để xác thực (dùng khi delete email)
    this.corsHeader = 'iaWg3pchvFx48fY'; // x-cors-header
  }

  /**
   * Khởi tạo client
   */
  async initialize() {
    try {
      // Load domains
      await this.loadDomains();
      return true;
    } catch (error) {
      console.error('Lỗi khởi tạo MailIO session:', error.message);
      return false;
    }
  }

  /**
   * Load danh sách domains
   */
  async loadDomains() {
    try {
      const response = await axios.get(`${this.baseURL}/v4/domains`, {
        headers: this.getHeaders()
      });

      if (response.data && response.data.domains && Array.isArray(response.data.domains)) {
        // Extract domain names từ array
        this.domains = response.data.domains.map(d => d.name);
        if (this.domains.length > 0 && !this.currentDomain) {
          this.currentDomain = this.domains[0];
        }
        return this.domains;
      }

      return [];
    } catch (error) {
      console.error('Lỗi load domains MailIO:', error.message);
      return [];
    }
  }

  /**
   * Lấy headers chuẩn cho API requests
   */
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Application-Name': 'web',
      'Application-Version': '4.0.0',
      'x-cors-header': this.corsHeader,
      'Origin': 'https://temp-mail.io',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Accept': '*/*'
    };
  }

  /**
   * Tạo email random
   */
  async createRandomEmail() {
    try {
      const payload = {
        min_name_length: 10,
        max_name_length: 10
      };

      const response = await axios.post(
        `${this.baseURL}/v3/email/new`,
        payload,
        {
          headers: this.getHeaders()
        }
      );

      if (response.data && response.data.email && response.data.token) {
        this.currentEmail = response.data.email;
        this.token = response.data.token;
        
        // Parse domain từ email
        if (this.currentEmail.includes('@')) {
          const [, domain] = this.currentEmail.split('@');
          this.currentDomain = domain;
        }

        return {
          success: true,
          email: response.data.email,
          username: this.currentEmail.split('@')[0],
          domain: this.currentDomain,
          token: response.data.token
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email random'
      };
    } catch (error) {
      console.error('Lỗi tạo email random MailIO:', error.message);
      
      // Xử lý lỗi từ API response
      if (error.response && error.response.data) {
        const apiError = error.response.data;
        if (apiError.error || apiError.message) {
          return {
            success: false,
            error: apiError.error || apiError.message,
            code: error.response.status
          };
        }
      }
      
      return {
        success: false,
        error: error.message || 'Không thể tạo email random'
      };
    }
  }

  /**
   * Tạo email với username tùy chỉnh
   */
  async createEmail(username, domain = null) {
    try {
      // Validate và clean username
      username = username ? username.trim() : '';
      
      // Chọn domain
      const selectedDomain = domain && this.domains.includes(domain) 
        ? domain 
        : (this.currentDomain || (this.domains.length > 0 ? this.domains[0] : null));

      if (!selectedDomain) {
        return {
          success: false,
          error: 'Không có domain khả dụng'
        };
      }

      // Tạo payload
      const payload = username 
        ? { name: username, domain: selectedDomain }
        : { min_name_length: 10, max_name_length: 10 };

      const response = await axios.post(
        `${this.baseURL}/v3/email/new`,
        payload,
        {
          headers: this.getHeaders()
        }
      );

      if (response.data && response.data.email && response.data.token) {
        this.currentEmail = response.data.email;
        this.token = response.data.token;
        this.currentDomain = selectedDomain;

        return {
          success: true,
          email: response.data.email,
          username: response.data.email.split('@')[0],
          domain: selectedDomain,
          token: response.data.token
        };
      }

      // Nếu có error
      if (response.data && (response.data.error || response.data.message)) {
        return {
          success: false,
          error: response.data.error || response.data.message,
          code: response.data.code
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email'
      };
    } catch (error) {
      console.error('Lỗi tạo email MailIO:', error.message);
      
      // Xử lý lỗi từ API response
      if (error.response && error.response.data) {
        const apiError = error.response.data;
        if (apiError.error || apiError.message) {
          return {
            success: false,
            error: apiError.error || apiError.message,
            code: error.response.status
          };
        }
      }
      
      return {
        success: false,
        error: error.message || 'Không thể tạo email',
        code: error.response?.status || 500
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
          error: 'Chưa có email',
          messages: [],
          count: 0
        };
      }

      // API mail.io không cần encode email trong URL path
      const response = await axios.get(
        `${this.baseURL}/v3/email/${this.currentEmail}/messages`,
        {
          headers: this.getHeaders()
        }
      );

      // Response là array (có thể rỗng [])
      const messages = Array.isArray(response.data) ? response.data : [];

      // Format messages để đồng nhất với các nguồn khác
      const formattedMessages = messages.map(msg => {
        // Parse created_at thành timestamp
        let timestamp = Date.now();
        if (msg.created_at) {
          const date = new Date(msg.created_at);
          timestamp = isNaN(date.getTime()) ? Date.now() : date.getTime();
        }

        return {
          id: msg.id || `${timestamp}-${Math.random()}`,
          from: msg.from || 'Unknown',
          to: msg.to || this.currentEmail,
          subject: msg.subject || '(No Subject)',
          body: msg.body_text || msg.body_html || '',
          html: msg.body_html || '',
          text: msg.body_text || '',
          date: timestamp,
          created_at: msg.created_at || null, // Giữ nguyên created_at để tính datediff
          attachments: msg.attachments || []
        };
      });

      return {
        success: true,
        messages: formattedMessages,
        count: formattedMessages.length
      };
    } catch (error) {
      console.error('Lỗi fetch messages MailIO:', error.message);
      
      // Xử lý lỗi từ API response để có thông tin chi tiết hơn
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        // Log chi tiết để debug
        console.error('MailIO API Error:', {
          status,
          data,
          email: this.currentEmail,
          url: `${this.baseURL}/v3/email/${this.currentEmail}/messages`
        });
        
        // Trả về error message từ API nếu có
        if (data && (data.error || data.message)) {
          return {
            success: false,
            error: data.error || data.message || `HTTP ${status}`,
            messages: [],
            count: 0,
            code: status
          };
        }
      }
      
      return {
        success: false,
        error: error.message || 'Không thể lấy messages',
        messages: [],
        count: 0,
        code: error.response?.status
      };
    }
  }

  /**
   * Lấy chi tiết message
   */
  async getMessageDetail(messageId) {
    try {
      if (!this.currentEmail) {
        return {
          success: false,
          error: 'Chưa có email'
        };
      }

      // Lấy tất cả messages và tìm message theo ID
      const messagesResult = await this.fetchMessages();
      if (!messagesResult.success) {
        return messagesResult;
      }

      const message = messagesResult.messages.find(m => m.id === messageId);
      if (!message) {
        return {
          success: false,
          error: 'Không tìm thấy message'
        };
      }

      return {
        success: true,
        message: message
      };
    } catch (error) {
      console.error('Lỗi lấy chi tiết message MailIO:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Xóa email
   */
  async deleteEmail() {
    try {
      if (!this.currentEmail || !this.token) {
        return {
          success: false,
          error: 'Chưa có email hoặc token'
        };
      }

      // API mail.io không cần encode email trong URL path
      const response = await axios.delete(
        `${this.baseURL}/v3/email/${this.currentEmail}`,
        {
          headers: this.getHeaders(),
          data: { token: this.token }
        }
      );

      // Response status 200 là thành công
      if (response.status === 200) {
        this.currentEmail = null;
        this.token = null;
        return {
          success: true
        };
      }

      return {
        success: false,
        error: 'Không thể xóa email'
      };
    } catch (error) {
      console.error('Lỗi xóa email MailIO:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Set current email và token
   */
  setCurrentEmail(email, token = null) {
    this.currentEmail = email;
    if (token) {
      this.token = token;
    }
    // Parse domain từ email
    if (email && email.includes('@')) {
      const [, domain] = email.split('@');
      this.currentDomain = domain;
    }
  }

  /**
   * Get token
   */
  getToken() {
    return this.token;
  }

  /**
   * Get domains
   */
  getDomains() {
    return this.domains;
  }

  /**
   * Get current email
   */
  getCurrentEmail() {
    return this.currentEmail;
  }
}

