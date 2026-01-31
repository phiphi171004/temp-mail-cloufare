import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

/**
 * eTempMail Client
 * Client để tương tác với etempmail.com API
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
    
    // Domain mapping (domain name -> domain ID)
    this.domainMap = {
      'ohm.edu.pl': 21,
      'cross.edu.pl': 20,
      'usa.edu.pl': 19,
      'beta.edu.pl': 18
    };
    
    // Domains list
    this.domains = Object.keys(this.domainMap);
    this.defaultDomain = 'ohm.edu.pl';
  }

  /**
   * Khởi tạo client
   */
  async initialize() {
    try {
      // Lấy cookie ban đầu bằng cách truy cập trang chủ
      await this.axios.get(this.baseURL, {
        headers: this.getHeaders()
      });
      
      return true;
    } catch (error) {
      console.error('Lỗi khởi tạo eTempMail client:', error.message);
      return false;
    }
  }

  /**
   * Lấy headers mặc định
   */
  getHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': this.baseURL,
      'Referer': `${this.baseURL}/`,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
  }

  /**
   * Tạo email random
   * eTempMail luôn tạo username random, không cho user nhập
   */
  async createRandomEmail() {
    try {
      const response = await this.axios.post(
        `${this.baseURL}/getEmailAddress`,
        null,
        {
          headers: this.getHeaders()
        }
      );

      if (response.data && response.data.address) {
        this.currentEmail = response.data.address;
        this.emailId = response.data.id;
        this.recoverKey = response.data.recover_key;
        this.creationTime = response.data.creation_time;
        
        // Parse domain từ email
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

      return {
        success: false,
        error: 'Không thể tạo email random'
      };
    } catch (error) {
      console.error('Lỗi tạo email random eTempMail:', error.message);
      
      if (error.response && error.response.data) {
        return {
          success: false,
          error: error.response.data.error || error.response.data.message || 'Không thể tạo email random'
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
   * Lưu ý: eTempMail không cho user nhập username, chỉ chọn domain
   * Username luôn được server tự tạo (random)
   */
  async createEmail(username = null, domain = null) {
    try {
      // eTempMail không cho user nhập username, luôn random
      // Nếu có domain, đổi domain trước, sau đó tạo email random
      if (domain && this.domainMap[domain]) {
        // Đổi domain trước
        const changeResult = await this.changeDomain(domain);
        if (!changeResult.success) {
          return changeResult;
        }
      }
      
      // Tạo email random (username luôn random)
      return await this.createRandomEmail();
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
   * @param {string} domain - Domain name (ví dụ: 'ohm.edu.pl')
   */
  async changeDomain(domain) {
    try {
      const domainId = this.domainMap[domain];
      if (!domainId) {
        return {
          success: false,
          error: `Domain ${domain} không hợp lệ. Các domain hợp lệ: ${this.domains.join(', ')}`
        };
      }

      const response = await this.axios.post(
        `${this.baseURL}/changeEmailAddress`,
        `id=${domainId}`,
        {
          headers: {
            ...this.getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          maxRedirects: 5,
          validateStatus: (status) => status < 400 // Chấp nhận redirect (301)
        }
      );

      // Sau khi đổi domain, cần tạo email mới
      // API changeEmailAddress trả về redirect về trang chủ
      // Nên ta cần gọi lại getEmailAddress để lấy email mới
      const emailResult = await this.createRandomEmail();
      
      if (emailResult.success) {
        this.currentDomain = domain;
        return {
          success: true,
          domain: domain,
          email: emailResult.email
        };
      }

      return {
        success: false,
        error: 'Đã đổi domain nhưng không thể tạo email mới'
      };
    } catch (error) {
      console.error('Lỗi đổi domain eTempMail:', error.message);
      return {
        success: false,
        error: error.message || 'Không thể đổi domain'
      };
    }
  }

  /**
   * Fetch messages từ inbox (alias cho getInbox để đồng nhất với các client khác)
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
          error: 'Chưa tạo email'
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
        // Transform data để match với format của các client khác
        const messages = response.data.map((msg, index) => ({
          id: index + 1, // eTempMail không có ID riêng, dùng index
          subject: msg.subject || '',
          from: msg.from || '',
          date: msg.date || '',
          body: msg.body || '', // eTempMail đã trả về full HTML body
          html: msg.body || '', // Alias cho body
          text: this.extractTextFromHTML(msg.body || '') // Extract text từ HTML
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
        error: error.message || 'Không thể lấy inbox'
      };
    }
  }

  /**
   * Extract text từ HTML
   */
  extractTextFromHTML(html) {
    if (!html) return '';
    
    // Simple text extraction (remove HTML tags)
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Lấy email hiện tại
   */
  getCurrentEmail() {
    return this.currentEmail;
  }

  /**
   * Lấy danh sách domains
   */
  getDomains() {
    return this.domains;
  }

  /**
   * Lấy domain hiện tại
   */
  getCurrentDomain() {
    return this.currentDomain || this.defaultDomain;
  }

  /**
   * Gia hạn thời gian email (20 phút)
   */
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

  /**
   * Xóa email
   */
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

  /**
   * Khôi phục email bằng recovery key
   */
  async recoverEmail(recoveryKey) {
    try {
      const response = await this.axios.post(
        `${this.baseURL}/recoverEmailAddress`,
        `key=${encodeURIComponent(recoveryKey)}`,
        {
          headers: {
            ...this.getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          maxRedirects: 5,
          validateStatus: (status) => status < 400
        }
      );

      // Sau khi recover, cần lấy lại email
      const emailResult = await this.createRandomEmail();
      
      if (emailResult.success) {
        return {
          success: true,
          email: emailResult.email,
          recover_key: emailResult.recover_key
        };
      }

      return {
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

