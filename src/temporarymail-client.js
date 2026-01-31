import axios from 'axios';

/**
 * TemporaryMail Client
 * Client kết nối với temporarymail.com
 */
export class TemporaryMailClient {
  constructor() {
    this.baseURL = 'https://temporarymail.com';
    this.domains = [];
    this.currentEmail = null;
    this.currentDomain = null;
    this.secretKey = null; // Secret key để truy cập inbox
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
      console.error('Lỗi khởi tạo TemporaryMail session:', error.message);
      return false;
    }
  }

  /**
   * Load danh sách domains
   */
  async loadDomains() {
    try {
      const response = await axios.get(`${this.baseURL}/api/?action=getDomains`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': `${this.baseURL}/`,
          'Origin': this.baseURL,
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      // Response là JSON array hoặc object với code error
      if (response.data && Array.isArray(response.data)) {
        this.domains = response.data;
        if (this.domains.length > 0 && !this.currentDomain) {
          this.currentDomain = this.domains[0];
        }
        return this.domains;
      }

      // Nếu có error code (ví dụ: 429)
      if (response.data && response.data.code) {
        console.error('Lỗi load domains TemporaryMail:', response.data.error || response.data.code);
        return [];
      }

      return [];
    } catch (error) {
      console.error('Lỗi load domains TemporaryMail:', error.message);
      return [];
    }
  }

  /**
   * Lấy danh sách domains
   */
  getDomains() {
    return this.domains;
  }

  /**
   * Tạo email random
   */
  async createRandomEmail() {
    try {
      // Gọi API với value="random" và key để trống
      const referrerParam = '&r=' + encodeURIComponent(this.baseURL);
      const response = await axios.get(
        `${this.baseURL}/api/?action=requestEmailAccess&key=&value=random${referrerParam}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': `${this.baseURL}/`,
            'Origin': this.baseURL,
            'X-Requested-With': 'XMLHttpRequest'
          },
          responseType: 'text' // API trả về text/plain, cần parse JSON thủ công
        }
      );

      // Parse response data (có thể là string JSON hoặc object)
      let responseData = response.data;
      if (typeof responseData === 'string') {
        try {
          responseData = JSON.parse(responseData);
        } catch (e) {
          // Nếu không parse được, giữ nguyên string
        }
      }

      if (responseData && responseData.address && responseData.secretKey) {
        this.currentEmail = responseData.address;
        this.secretKey = responseData.secretKey;

        // Parse domain từ email
        if (this.currentEmail.includes('@')) {
          const [, domain] = this.currentEmail.split('@');
          this.currentDomain = domain;
        }

        return {
          success: true,
          email: responseData.address,
          username: this.currentEmail.split('@')[0],
          domain: this.currentDomain,
          secretKey: responseData.secretKey
        };
      }

      // Nếu có error
      if (responseData && responseData.error) {
        return {
          success: false,
          error: responseData.error,
          code: responseData.code
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email random'
      };
    } catch (error) {
      console.error('Lỗi tạo email random TemporaryMail:', error.message);
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
      username = username ? username.replace(/[^a-zA-Z0-9.]/gi, '').replace(/\s/g, '') : '';

      if (username && username.length > 63) {
        username = username.substring(0, 63);
      }

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

      // Tạo email address
      const email = username ? `${username}@${selectedDomain}` : `random@${selectedDomain}`;

      // Khi tạo email mới, key phải để trống (theo API của temporarymail)
      // Chỉ khi tái sử dụng email cũ mới truyền key cũ
      const keyParam = ''; // Luôn để trống khi tạo email mới
      const valueParam = username ? email : 'random';
      const referrerParam = '&r=' + encodeURIComponent(this.baseURL); // Thêm referrer như API thật

      const response = await axios.get(
        `${this.baseURL}/api/?action=requestEmailAccess&key=${keyParam}&value=${encodeURIComponent(valueParam)}${referrerParam}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': `${this.baseURL}/`,
            'Origin': this.baseURL,
            'X-Requested-With': 'XMLHttpRequest'
          },
          responseType: 'text' // API trả về text/plain, cần parse JSON thủ công
        }
      );

      // Parse response data (có thể là string JSON hoặc object)
      let responseData = response.data;
      if (typeof responseData === 'string') {
        try {
          responseData = JSON.parse(responseData);
        } catch (e) {
          // Nếu không parse được, giữ nguyên string
        }
      }

      if (responseData && responseData.address && responseData.secretKey) {
        this.currentEmail = responseData.address;
        this.secretKey = responseData.secretKey;
        this.currentDomain = selectedDomain;

        return {
          success: true,
          email: responseData.address,
          username: responseData.address.split('@')[0],
          domain: selectedDomain,
          secretKey: responseData.secretKey
        };
      }

      // Nếu có error
      if (responseData && responseData.error) {
        return {
          success: false,
          error: responseData.error,
          code: responseData.code
        };
      }

      return {
        success: false,
        error: 'Không thể tạo email'
      };
    } catch (error) {
      console.error('Lỗi tạo email TemporaryMail:', error.message);

      // Xử lý lỗi từ API response
      if (error.response && error.response.data) {
        const apiError = error.response.data;

        // Nếu API trả về error object
        if (apiError.error) {
          return {
            success: false,
            error: apiError.error,
            code: apiError.code || error.response.status
          };
        }

        // Nếu API trả về string error
        if (typeof apiError === 'string') {
          try {
            const parsed = JSON.parse(apiError);
            if (parsed.error) {
              return {
                success: false,
                error: parsed.error,
                code: parsed.code || error.response.status
              };
            }
          } catch (e) {
            // Không phải JSON, trả về string
            return {
              success: false,
              error: apiError,
              code: error.response.status
            };
          }
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
      if (!this.secretKey) {
        return {
          success: false,
          error: 'Chưa có secretKey. Vui lòng tạo email trước.',
          messages: [],
          count: 0
        };
      }

      // Gọi API check inbox với secretKey
      const response = await axios.get(
        `${this.baseURL}/api/?action=checkInbox&value=${this.secretKey}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': `${this.baseURL}/`,
            'Origin': this.baseURL,
            'X-Requested-With': 'XMLHttpRequest'
          }
        }
      );

      // Response có thể là [] (empty) hoặc object với messageId làm key
      let messages = [];

      if (Array.isArray(response.data)) {
        // Empty array
        messages = [];
      } else if (response.data && typeof response.data === 'object') {
        // Object với messageId làm key
        if (response.data.error) {
          return {
            success: false,
            error: response.data.error,
            code: response.data.code,
            messages: [],
            count: 0
          };
        }

        // Convert object thành array
        messages = Object.values(response.data);
      }

      // Format messages để đồng nhất với format khác
      const formattedMessages = messages.map((msg, index) => {
        return {
          id: msg.id || `msg-${index}`,
          m_id: msg.id,
          subject: msg.subject || '[No Subject]',
          sender_name: msg.name || '',
          sender_email: msg.from || '',
          to: msg.to || this.currentEmail,
          date: msg.date ? new Date(msg.date * 1000).toISOString() : null, // Convert timestamp to ISO
          datediff: this.calculateDateDiff(msg.date ? new Date(msg.date * 1000) : null),
          timestamp: msg.date ? msg.date * 1000 : null,
          content: '', // TemporaryMail không trả về content trong list
          content_raw: '',
          hasAttm: (msg.attachments && msg.attachments.length > 0) ? msg.attachments.length : 0,
          attachments: msg.attachments || [],
          sourceHash: msg.sourceHash || null
        };
      });

      return {
        success: true,
        messages: formattedMessages,
        count: formattedMessages.length
      };
    } catch (error) {
      console.error('Lỗi fetch messages TemporaryMail:', error.message);
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
      // Bước 1: Gọi API getEmail để lấy metadata
      const response = await axios.post(
        `${this.baseURL}/api/?action=getEmail&value=${messageId}`,
        {},
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': this.baseURL,
            'Referer': `${this.baseURL}/vi/`
          }
        }
      );

      // Response là object với messageId làm key
      if (response.data && typeof response.data === 'object') {
        // Nếu có error
        if (response.data.error) {
          return {
            success: false,
            error: response.data.error,
            code: response.data.code
          };
        }

        // Lấy message data (key là messageId)
        const messageData = response.data[messageId] || Object.values(response.data)[0];

        if (!messageData) {
          return {
            success: false,
            error: 'Không tìm thấy message'
          };
        }

        // Bước 2: Lấy HTML content từ /view/ endpoint
        let htmlContent = null;
        try {
          const htmlResponse = await axios.get(
            `${this.baseURL}/view/?i=${messageId}&width=0`,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
              }
            }
          );

          if (htmlResponse.data && typeof htmlResponse.data === 'string') {
            htmlContent = htmlResponse.data;
          }
        } catch (htmlError) {
          console.warn('Không thể lấy HTML content:', htmlError.message);
          // Không throw error, chỉ log warning
        }

        // Format response
        return {
          success: true,
          content: htmlContent || '',
          content_raw: htmlContent || '',
          html: htmlContent,
          text: null, // TemporaryMail không cung cấp text version riêng
          subject: messageData.subject || '',
          from: messageData.from || '',
          to: messageData.to || '',
          date: messageData.date ? new Date(messageData.date * 1000).toISOString() : null,
          hasAttm: (messageData.attachments && messageData.attachments.length > 0) ? messageData.attachments.length : 0,
          attachments: messageData.attachments || [],
          sourceHash: messageData.sourceHash || null
        };
      }

      return {
        success: false,
        error: 'Không thể lấy nội dung message'
      };
    } catch (error) {
      console.error('Lỗi lấy chi tiết message TemporaryMail:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate date difference (datediff)
   */
  calculateDateDiff(date) {
    if (!date) return null;
    try {
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
   * Set current email và secretKey (dùng khi sync)
   */
  setCurrentEmail(email, secretKey = null) {
    this.currentEmail = email;
    if (secretKey) {
      this.secretKey = secretKey;
    }
    if (email && email.includes('@')) {
      const [, domain] = email.split('@');
      this.currentDomain = domain;
    }
  }

  /**
   * Get current email
   */
  getCurrentEmail() {
    return this.currentEmail;
  }

  /**
   * Get secret key
   */
  getSecretKey() {
    return this.secretKey;
  }

  /**
   * Get all emails (for compatibility with other clients)
   */
  getAllEmails() {
    return this.currentEmail ? [this.currentEmail] : [];
  }
}

