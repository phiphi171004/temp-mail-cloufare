import axios from 'axios';
import { CONFIG } from './config.js';

/**
 * TempMail ID Client
 * Client kết nối với tempmail.id.vn API
 */
export class TempMailIDClient {
  constructor() {
    // Nếu dùng Cloudflare Worker, route qua Worker
    if (CONFIG.USE_CLOUDFLARE_WORKER && CONFIG.CLOUDFLARE_WORKER_URL) {
      this.baseURL = CONFIG.CLOUDFLARE_WORKER_URL + '/tempmail-id';
    } else {
      this.baseURL = 'https://tempmail.id.vn/api';
    }
    this.apiToken = CONFIG.TEMPMAIL_ID_API_TOKEN || '';
    this.currentEmail = null;
    this.currentEmailId = null;
    this.domains = ['tempmail.id.vn', '1trick.net', 'hathitranhnhien.edu.vn', 'nghienplus.io.vn', 'tempmail.ckvn.edu.vn']; // Domains mặc định
  }

  /**
   * Khởi tạo - kiểm tra API token và load domains
   */
  async initialize() {
    try {
      if (!this.apiToken) {
        throw new Error('TEMPMAIL_ID_API_TOKEN chưa được cấu hình trong .env');
      }
      
      // Kiểm tra token bằng cách lấy thông tin user
      try {
        await this.getUserInfo();
      } catch (error) {
        throw new Error(`API Token không hợp lệ: ${error.message}`);
      }
      
      // Load danh sách domains
      await this.loadDomains();
      
      return true;
    } catch (error) {
      console.error('✗ Lỗi khởi tạo TempMail ID:', error.message);
      return false;
    }
  }

  /**
   * Load danh sách domains từ API
   */
  async loadDomains() {
    try {
      // Gọi API đúng endpoint: /api/domain (không có 's')
      const response = await axios.get(`${this.baseURL}/domain`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        },
        validateStatus: () => true // Không throw error cho mọi status code
      });

      // Chỉ xử lý nếu response thành công (status 200)
      if (response.status === 200 && response.data) {
        // Format từ tempmail.id.vn: { success: true, data: [{ id, name }, ...] }
        if (response.data.success && response.data.data && Array.isArray(response.data.data)) {
          // Extract name từ mỗi object
          this.domains = response.data.data.map(item => item.name || item);
        }
        // Format 1: Array trực tiếp
        else if (Array.isArray(response.data)) {
          // Nếu là array of objects, extract name
          this.domains = response.data.map(item => item.name || item);
        }
        // Format 2: { data: [...] }
        else if (response.data.data && Array.isArray(response.data.data)) {
          this.domains = response.data.data.map(item => item.name || item);
        }
        // Format 3: { domains: [...] }
        else if (response.data.domains && Array.isArray(response.data.domains)) {
          this.domains = response.data.domains.map(item => item.name || item);
        }

        // Đảm bảo tempmail.id.vn luôn có trong danh sách và ở đầu
        if (this.domains.length > 0) {
          // Xóa tempmail.id.vn nếu có ở vị trí khác
          this.domains = this.domains.filter(d => d !== 'tempmail.id.vn');
          // Thêm tempmail.id.vn vào đầu
          this.domains.unshift('tempmail.id.vn');
        }
      } else {
        // API không có endpoint domains hoặc trả về lỗi, throw để vào catch
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      // Nếu API không có endpoint domains, extract từ danh sách emails
      try {
        const emails = await this.getAllEmails();
        const domainSet = new Set();
        
        // Extract domains từ emails
        emails.forEach(email => {
          if (email && email.includes('@')) {
            const domain = email.split('@')[1];
            if (domain) {
              domainSet.add(domain);
            }
          }
        });
        
        // Thêm domains từ danh sách emails
        if (domainSet.size > 0) {
          this.domains = Array.from(domainSet);
          // Đảm bảo tempmail.id.vn luôn có
          if (!this.domains.includes('tempmail.id.vn')) {
            this.domains.unshift('tempmail.id.vn');
          }
        }
      } catch (e) {
        // Nếu không lấy được, dùng danh sách mặc định từ ảnh
        this.domains = ['tempmail.id.vn', '1trick.net', 'hathitranhnhien.edu.vn', 'nghienplus.io.vn', 'tempmail.ckvn.edu.vn'];
      }
    }
    
    // Đảm bảo luôn có ít nhất danh sách mặc định
    if (this.domains.length === 0 || (this.domains.length === 1 && this.domains[0] === 'tempmail.id.vn')) {
      this.domains = ['tempmail.id.vn', '1trick.net', 'hathitranhnhien.edu.vn', 'nghienplus.io.vn', 'tempmail.ckvn.edu.vn'];
    }
  }

  /**
   * Lấy thông tin user
   */
  async getUserInfo() {
    const response = await axios.get(`${this.baseURL}/user`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`
      }
    });

    return response.data;
  }

  /**
   * Tạo email ngẫu nhiên
   */
  async createRandomEmail() {
    return await this.createEmail(null, null);
  }

  /**
   * Tạo email với username và domain
   * @param {string} username - Username (null = random)
   * @param {string} domain - Domain (null = random)
   */
  async createEmail(username = null, domain = null) {
    try {
      const payload = {};
      
      if (username) {
        payload.user = username;
      }
      
      if (domain) {
        payload.domain = domain;
      }
      
      // Optional: generate_guest_link và guest_link_expiration_days
      // Không set để dùng mặc định của API
      
      // Nếu không có username và domain, tạo random
      const response = await axios.post(`${this.baseURL}/email/create`, payload, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        },
        validateStatus: () => true // Không throw error để xử lý response
      });

      // Kiểm tra nếu API trả về lỗi
      if (response.status !== 200 && response.status !== 201) {
        const errorMessage = response.data?.message || response.data?.error || `API returned status ${response.status}`;
        
        // Nếu lỗi về domain không tìm thấy, thử lại với domain mặc định
        if ((errorMessage.includes('tên miền') || errorMessage.includes('domain') || errorMessage.includes('Không tìm thấy')) && domain && domain !== 'tempmail.id.vn') {
          // Thử lại với tempmail.id.vn
          const retryPayload = { ...payload };
          if (username) {
            retryPayload.user = username;
          }
          // Không set domain, để API tự chọn domain mặc định
          delete retryPayload.domain;
          
          const retryResponse = await axios.post(`${this.baseURL}/email/create`, retryPayload, {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiToken}`
            },
            validateStatus: () => true
          });
          
          if (retryResponse.status === 200 || retryResponse.status === 201) {
            // Thành công với domain mặc định
            if (retryResponse.data && retryResponse.data.success && retryResponse.data.data && retryResponse.data.data.email) {
              this.currentEmail = retryResponse.data.data.email;
              this.currentEmailId = retryResponse.data.data.id || null;
              
              return {
                success: true,
                email: this.currentEmail,
                emailId: this.currentEmailId,
                warning: `Domain "${domain}" không được hỗ trợ, đã tạo email với domain mặc định.`
              };
            }
          }
          
          return {
            success: false,
            error: `Domain "${domain}" không được hỗ trợ. Vui lòng chọn domain khác hoặc để trống để dùng domain mặc định.`
          };
        }
        
        return {
          success: false,
          error: errorMessage
        };
      }

      // Kiểm tra response format
      if (response.data) {
        // Format từ tempmail.id.vn: { success: true, message: "...", data: { id, email, ... } }
        if (response.data.success && response.data.data && response.data.data.email) {
          this.currentEmail = response.data.data.email;
          this.currentEmailId = response.data.data.id || null;
          
          return {
            success: true,
            email: this.currentEmail,
            emailId: this.currentEmailId
          };
        }
        
        // Format 1: { email: "...", id: ... } (direct format)
        if (response.data.email) {
          this.currentEmail = response.data.email;
          this.currentEmailId = response.data.id || null;
          
          return {
            success: true,
            email: this.currentEmail,
            emailId: this.currentEmailId
          };
        }
        
        // Format 2: { success: true, email: "...", ... } (nested success)
        if (response.data.success && response.data.email) {
          this.currentEmail = response.data.email;
          this.currentEmailId = response.data.id || response.data.emailId || null;
          
          return {
            success: true,
            email: this.currentEmail,
            emailId: this.currentEmailId
          };
        }
        
        // Nếu có error message trong response (chỉ khi success = false)
        if (response.data.success === false && (response.data.error || response.data.message)) {
          return {
            success: false,
            error: response.data.error || response.data.message || 'Không thể tạo email'
          };
        }
      }
      return {
        success: false,
        error: 'Không thể tạo email - Response format không đúng'
      };
    } catch (error) {
      console.error('✗ Error creating email:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      // Trả về error message chi tiết hơn
      let errorMessage = 'Không thể tạo email';
      if (error.response?.data) {
        if (error.response.data.error) {
          errorMessage = error.response.data.error;
        } else if (error.response.data.message) {
          errorMessage = error.response.data.message;
        } else if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Fetch messages từ email hiện tại
   */
  async fetchMessages() {
    // Nếu không có emailId, thử lấy từ email hiện tại
    if (!this.currentEmailId) {
      if (this.currentEmail) {
        try {
          const emailId = await this.getEmailIdFromEmail(this.currentEmail);
          if (emailId) {
            this.currentEmailId = emailId;
          } else {
            return {
              success: false,
              error: 'Không tìm thấy email ID. Vui lòng tạo email mới.',
              messages: [],
              count: 0
            };
          }
        } catch (e) {
          console.error('Lỗi lấy emailId:', e.message);
          return {
            success: false,
            error: 'Không thể lấy email ID. Vui lòng tạo email mới.',
            messages: [],
            count: 0
          };
        }
      } else {
        return {
          success: false,
          error: 'Chưa có email. Vui lòng tạo email mới.',
          messages: [],
          count: 0
        };
      }
    }

    try {
      const response = await axios.get(`${this.baseURL}/email/${this.currentEmailId}`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        }
      });

      // Xử lý nhiều format response
      let messagesArray = null;
      
      // Format 1: { success: true, data: { items: [...] } } - Format từ tempmail.id.vn
      if (response.data && response.data.data && response.data.data.items && Array.isArray(response.data.data.items)) {
        messagesArray = response.data.data.items;
      }
      // Format 2: { messages: [...] }
      else if (response.data && response.data.messages && Array.isArray(response.data.messages)) {
        messagesArray = response.data.messages;
      }
      // Format 3: { data: { messages: [...] } }
      else if (response.data && response.data.data && response.data.data.messages && Array.isArray(response.data.data.messages)) {
        messagesArray = response.data.data.messages;
      }
      // Format 4: { success: true, data: [...] } (array trực tiếp trong data)
      else if (response.data && response.data.success && response.data.data && Array.isArray(response.data.data)) {
        messagesArray = response.data.data;
      }
      // Format 5: Array trực tiếp
      else if (Array.isArray(response.data)) {
        messagesArray = response.data;
      }
      // Format 6: { data: [...] } (array trực tiếp trong data)
      else if (response.data && response.data.data && Array.isArray(response.data.data)) {
        messagesArray = response.data.data;
      }

      if (messagesArray) {
        const messages = messagesArray.map((msg, index) => {
          // Format date - hỗ trợ nhiều field name
          let date = null;
          let datediff = null;
          const timestamp = msg.created_at || msg.timestamp || msg.date;
          if (timestamp) {
            const msgDate = new Date(timestamp);
            date = msgDate.toLocaleString('vi-VN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
            
            // Tính datediff
            const now = new Date();
            const diff = Math.floor((now - msgDate) / 1000);
            if (diff < 60) {
              datediff = `${diff} giây trước`;
            } else if (diff < 3600) {
              datediff = `${Math.floor(diff / 60)} phút trước`;
            } else if (diff < 86400) {
              datediff = `${Math.floor(diff / 3600)} giờ trước`;
            } else {
              datediff = `${Math.floor(diff / 86400)} ngày trước`;
            }
          }

          return {
            id: msg.id || msg.message_id || `msg-${index}`,
            subject: msg.subject || msg.title || 'Không có tiêu đề',
            sender_name: msg.from_name || msg.sender_name || msg.from?.name || 'Không rõ',
            sender_email: msg.from_email || msg.sender_email || msg.from?.email || msg.from || '',
            date: date,
            datediff: datediff,
            timestamp: timestamp || null,
            content: msg.body || msg.content || msg.html || '',
            content_raw: msg.body || msg.content || msg.html || msg.raw || '',
            attachments: msg.attachments || []
          };
        });

        return {
          success: true,
          messages: messages,
          count: messages.length
        };
      }

      // Nếu không có messages, có thể là email chưa có thư nào
      return {
        success: true,
        messages: [],
        count: 0
      };
    } catch (error) {
      
      // Trả về error message chi tiết hơn
      let errorMessage = 'Không thể lấy danh sách thư';
      if (error.response?.data) {
        if (error.response.data.error) {
          errorMessage = error.response.data.error;
        } else if (error.response.data.message) {
          errorMessage = error.response.data.message;
        } else if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        success: false,
        error: errorMessage,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Lấy danh sách domains
   */
  getDomains() {
    // Nếu chưa load được domains từ API, dùng danh sách mặc định
    if (this.domains.length === 0 || (this.domains.length === 1 && this.domains[0] === 'tempmail.id.vn')) {
      // Set domains mặc định từ ảnh user cung cấp
      this.domains = ['tempmail.id.vn', '1trick.net', 'hathitranhnhien.edu.vn', 'nghienplus.io.vn', 'tempmail.ckvn.edu.vn'];
    }
    return this.domains;
  }

  /**
   * Lấy email hiện tại
   */
  getCurrentEmail() {
    return this.currentEmail;
  }

  /**
   * Lấy tất cả emails (với ID)
   */
  async getAllEmails() {
    try {
      const response = await axios.get(`${this.baseURL}/email`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        }
      });

      if (response.data && Array.isArray(response.data)) {
        // Nếu có email hiện tại nhưng chưa có emailId, tìm trong danh sách
        if (this.currentEmail && !this.currentEmailId) {
          const foundEmail = response.data.find(email => 
            (email.email || email.address) === this.currentEmail
          );
          if (foundEmail && foundEmail.id) {
            this.currentEmailId = foundEmail.id;
          }
        }
        
        return response.data.map(email => email.email || email.address);
      }

      return [];
    } catch (error) {
      console.error('Lỗi lấy danh sách emails:', error.message);
      return [];
    }
  }

  /**
   * Lấy chi tiết message (body đầy đủ)
   */
  async getMessageDetail(messageId) {
    if (!messageId) {
      return {
        success: false,
        error: 'Message ID is required'
      };
    }

    try {
      const response = await axios.get(`${this.baseURL}/message/${messageId}`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        }
      });

      console.log(`[TempMailID] getMessageDetail response:`, JSON.stringify(response.data).substring(0, 500));

      // Xử lý response format
      let messageData = null;
      
      // Format: { success: true, message: "...", data: { id, body, ... } }
      if (response.data && response.data.success && response.data.data) {
        messageData = response.data.data;
        console.log(`[TempMailID] Parsed messageData from response.data.data`);
      }
      // Format: { data: { id, body, ... } }
      else if (response.data && response.data.data) {
        messageData = response.data.data;
        console.log(`[TempMailID] Parsed messageData from response.data.data (no success field)`);
      }
      // Format: { id, body, ... } (direct)
      else if (response.data && response.data.id) {
        messageData = response.data;
        console.log(`[TempMailID] Parsed messageData from response.data (direct)`);
      } else {
        console.warn(`[TempMailID] Không thể parse messageData từ response:`, response.data);
      }

      if (messageData) {
        // Format date
        let date = null;
        let datediff = null;
        const timestamp = messageData.created_at || messageData.timestamp || messageData.date;
        if (timestamp) {
          const msgDate = new Date(timestamp);
          date = msgDate.toLocaleString('vi-VN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          
          const now = new Date();
          const diff = Math.floor((now - msgDate) / 1000);
          if (diff < 60) {
            datediff = `${diff} giây trước`;
          } else if (diff < 3600) {
            datediff = `${Math.floor(diff / 60)} phút trước`;
          } else if (diff < 86400) {
            datediff = `${Math.floor(diff / 3600)} giờ trước`;
          } else {
            datediff = `${Math.floor(diff / 86400)} ngày trước`;
          }
        }

        // Trả về format phẳng để server.js dễ xử lý (giống noopmail-client.js)
        return {
          success: true,
          id: messageData.id || messageData.message_id,
          subject: messageData.subject || messageData.title || 'Không có tiêu đề',
          sender_name: messageData.sender_name || messageData.from_name || 'Không rõ',
          from: messageData.from || messageData.from_email || messageData.sender_email || '',
          to: messageData.to || '',
          date: date,
          datediff: datediff,
          timestamp: timestamp || null,
          content: messageData.body || messageData.content || messageData.html || '',
          content_raw: messageData.body || messageData.content || messageData.html || messageData.raw || '',
          html: messageData.body || messageData.html || null, // Body từ tempmail.id.vn là HTML
          text: messageData.text || null,
          read_at: messageData.read_at || null,
          attachments: messageData.attachments || [],
          hasAttm: (messageData.attachments && messageData.attachments.length > 0) ? messageData.attachments.length : 0
        };
      }

      return {
        success: false,
        error: 'Không tìm thấy nội dung message'
      };
    } catch (error) {
      
      let errorMessage = 'Không thể lấy nội dung message';
      if (error.response?.data) {
        if (error.response.data.error) {
          errorMessage = error.response.data.error;
        } else if (error.response.data.message) {
          errorMessage = error.response.data.message;
        }
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Lấy emailId từ email address (nếu chưa có)
   */
  async getEmailIdFromEmail(emailAddress) {
    if (!emailAddress) return null;
    
    try {
      const response = await axios.get(`${this.baseURL}/email`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        }
      });

      // Format 1: Array trực tiếp
      let emails = null;
      if (Array.isArray(response.data)) {
        emails = response.data;
      } 
      // Format 2: { data: [...] }
      else if (response.data && Array.isArray(response.data.data)) {
        emails = response.data.data;
      }
      // Format 3: { success: true, data: [...] }
      else if (response.data && response.data.success && Array.isArray(response.data.data)) {
        emails = response.data.data;
      }

      if (emails && emails.length > 0) {
        const foundEmail = emails.find(email => {
          const emailValue = email.email || email.address || email;
          return emailValue === emailAddress;
        });
        
        if (foundEmail) {
          const emailId = foundEmail.id || foundEmail.email_id;
          if (emailId) {
            return emailId;
          }
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
}

