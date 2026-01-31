import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * NoopMail Client
 * Client kết nối với noopmail.org
 */
export class NoopMailClient {
  constructor() {
    this.baseURL = 'https://noopmail.org';
    this.domains = [];
    this.currentEmail = null;
    this.currentDomain = null;
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

      // Load domains
      await this.loadDomains();

      return true;
    } catch (error) {
      console.error('Lỗi khởi tạo NoopMail session:', error.message);
      return false;
    }
  }

  /**
   * Load danh sách domains
   */
  async loadDomains() {
    try {
      const response = await axios.get(`${this.baseURL}/api/d`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Cookie': this.getCookieString(),
          'Origin': this.baseURL,
          'Referer': this.baseURL
        }
      });

      if (response.data && Array.isArray(response.data)) {
        this.domains = response.data;
        if (this.domains.length > 0 && !this.currentDomain) {
          this.currentDomain = this.domains[0];
        }
        return this.domains;
      }

      return [];
    } catch (error) {
      console.error('Lỗi load domains NoopMail:', error.message);
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
      
      // Chọn domain random nếu chưa có
      if (!this.currentDomain && this.domains.length > 0) {
        this.currentDomain = this.domains[Math.floor(Math.random() * this.domains.length)];
      }

      const email = `${username}@${this.currentDomain}`;
      this.currentEmail = email;

      return {
        success: true,
        email: email,
        username: username,
        domain: this.currentDomain
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
            'Content-Type': 'application/json;charset=UTF-8',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            'Cookie': this.getCookieString(),
            'Origin': this.baseURL,
            'Referer': this.baseURL
          }
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
            senderName = fromMatch[1].trim();
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
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Cookie': this.getCookieString(),
            'Origin': this.baseURL,
            'Referer': `${this.baseURL}/detail/?i=${messageId}`
          }
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
        responseType: 'text'
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
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Cookie': this.getCookieString(),
                'Origin': this.baseURL,
                'Referer': `${this.baseURL}/detail/?i=${messageId}`
              }
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

