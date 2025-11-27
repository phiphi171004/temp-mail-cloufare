import { MailSourceManager } from './mail-source-manager.js';
import { CONFIG } from './config.js';
import * as cheerio from 'cheerio';

/**
 * TempMail Service
 * Cung cấp các chức năng chính cho temp mail
 * Hỗ trợ nhiều nguồn mail khác nhau
 */
export class TempMail {
  constructor(sourceId = 'tmail') {
    this.sourceManager = new MailSourceManager();
    this.currentEmail = null;
    this.emails = [];
    this.domain = null;
    this.sourceId = sourceId;
  }

  /**
   * Khởi tạo service
   */
  async init(sourceId = null) {
    if (sourceId) {
      this.sourceId = sourceId;
    }
    
    const initialized = await this.sourceManager.initSource(this.sourceId);
    
    if (initialized) {
      this.domain = this.sourceManager.getCurrentDefaultDomain();
    }
    
    return initialized;
  }

  /**
   * Chuyển đổi nguồn mail
   */
  async switchSource(sourceId) {
    await this.sourceManager.switchSource(sourceId);
    this.sourceId = sourceId;
    this.domain = this.sourceManager.getCurrentDefaultDomain();
    this.currentEmail = null;
    this.emails = [];
  }

  /**
   * Lấy client hiện tại
   */
  get client() {
    return this.sourceManager.getCurrentClient();
  }

  /**
   * Tạo email tạm mới với username tùy chỉnh
   * Hỗ trợ cả 2 nguồn: tmail và imail
   */
  async createEmail(username, domain = null) {
    // TempMail ID không cần username (có thể để null để random)
    if (this.sourceId !== 'tempmail-id') {
      // Validate username: 3-15 ký tự (chỉ cho TMail và iMail)
      if (!username || username.trim().length < 3) {
        return {
          success: false,
          error: 'Username phải có ít nhất 3 ký tự'
        };
      }
      
      if (username.trim().length > 15) {
        return {
          success: false,
          error: 'Username không được vượt quá 15 ký tự'
        };
      }
      
      // Trim username
      username = username.trim();
    }
    
    // Chọn domain: Ưu tiên domain truyền vào, nếu không có thì dùng default
    const availableDomains = this.sourceManager.getCurrentDomains();
    const selectedDomain = (domain && availableDomains.includes(domain)) ? domain : this.domain;

    // Xử lý theo nguồn mail
    if (this.sourceId === 'imail') {
      return {
        success: false,
        error: 'iMail source đã bị vô hiệu hóa do không ổn định'
      };
    } else if (this.sourceId === 'tempmail-id') {
      return await this.createEmailTempMailID(username, selectedDomain);
    } else if (this.sourceId === 'noopmail') {
      return await this.createEmailNoopMail(username, selectedDomain);
    } else {
      return await this.createEmailTMail(username, selectedDomain);
    }
  }

  /**
   * Tạo email cho nguồn iMail
   */
  async createEmailIMail(username, domain) {
    try {
      // iMail: Set domain trước nếu cần
      if (domain && domain !== this.domain) {
        await this.client.setDomain(domain);
        this.domain = domain;
      }

      // iMail: Set user và domain, sau đó gọi create
      await this.client.setUser(username);
      if (domain) {
        await this.client.setDomain(domain);
      }

      // iMail: Tạo email custom với username và domain đã set
      const result = await this.client.createEmail(username, domain);
      
      if (result.success) {
        this.currentEmail = result.email;
        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }
        
        // Update emails list từ client
        const allEmails = this.client.getAllEmails();
        if (allEmails.length > 0) {
          this.emails = allEmails;
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn TempMail ID
   */
  async createEmailTempMailID(username, domain) {
    try {
      // TempMail ID: Username có thể null (random) hoặc custom
      // Domain có thể null (random) hoặc 'tempmail.id.vn'
      const result = await this.client.createEmail(username || null, domain || null);
      
      if (result.success) {
        this.currentEmail = result.email;
        // Set currentEmail vào client để client biết email nào đang dùng
        this.client.currentEmail = result.email;
        // Lưu emailId để fetch messages sau này
        if (result.emailId) {
          this.client.currentEmailId = result.emailId;
        }
        
        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }
        
        // Update emails list từ client
        try {
          const allEmails = await this.client.getAllEmails();
          if (allEmails.length > 0) {
            this.emails = allEmails;
          }
        } catch (e) {
          // Ignore nếu không lấy được danh sách emails
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn NoopMail
   */
  async createEmailNoopMail(username, domain) {
    try {
      const result = await this.client.createEmail(username, domain);
      
      if (result.success) {
        this.currentEmail = result.email;
        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }
        
        return {
          success: true,
          email: this.currentEmail,
          domain: result.domain
        };
      }
      
      return result;
    } catch (error) {
      console.error('Lỗi tạo email NoopMail:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn TMail (mmocommunity.io.vn)
   */
  async createEmailTMail(username, selectedDomain) {
    const newEmail = `${username}@${selectedDomain}`;
    const currentDomain = this.domain;

    // BƯỚC 1: Nếu domain khác domain hiện tại, gọi setDomain trước
    if (selectedDomain !== currentDomain) {
      // Không override email trong snapshot khi setDomain
      const actionsSnapshot = this.client.getSnapshot(
        'frontend.actions',
        null, // Không override email, giữ nguyên
        this.emails.length > 0 ? this.emails : null
      );

      const setDomainPayload = {
        components: [
          {
            snapshot: actionsSnapshot,
            calls: [
              {
                path: '',
                method: 'setDomain',
                params: [selectedDomain]
              }
            ],
            updates: {
              user: username
            }
          }
        ]
      };

      try {
        const setDomainResponse = await this.client.sendRequest(setDomainPayload);
        
        if (setDomainResponse.components && setDomainResponse.components[0]) {
          const component = setDomainResponse.components[0];
          if (component.snapshot) {
            try {
              const snapshotData = JSON.parse(component.snapshot);
              if (snapshotData.data && snapshotData.data.domain) {
                this.domain = snapshotData.data.domain;
              }
            } catch (e) {
              // Ignore
            }
          }
        }
      } catch (error) {
        console.error('Error setting domain:', error.message);
      }
    }

    // BƯỚC 2: Gọi create
    // QUAN TRỌNG: Khi tạo email mới, không truyền currentEmail (null) vào snapshot
    // Vì snapshot từ server đã có email cũ (nếu có), nếu override = null sẽ làm checksum không khớp
    // Chỉ truyền emails nếu có, email sẽ được server set sau khi create thành công
    const actionsSnapshot = this.client.getSnapshot(
      'frontend.actions',
      null, // Không override email, giữ nguyên email trong snapshot (nếu có)
      this.emails.length > 0 ? this.emails : null
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
          updates: selectedDomain !== currentDomain ? {} : { user: username }
        }
      ]
    };

    try {
      const response = await this.client.sendRequest(createPayload);
      
      // Debug: Log response để kiểm tra
      console.log(`[createEmailTMail] Response received:`, JSON.stringify(response).substring(0, 500));
      
      // Update email và emails từ response
      if (response.components && response.components[0]) {
        const component = response.components[0];
        
        if (component.snapshot) {
          try {
            const snapshotData = JSON.parse(component.snapshot);
            console.log(`[createEmailTMail] Snapshot data:`, JSON.stringify(snapshotData.data).substring(0, 300));
            if (snapshotData.data && snapshotData.data.email) {
              const oldEmail = this.currentEmail;
              this.currentEmail = snapshotData.data.email;
              console.log(`[createEmailTMail] Email updated from response: ${oldEmail || 'null'} → ${this.currentEmail}`);
              if (!this.emails.includes(this.currentEmail)) {
                this.emails.push(this.currentEmail);
              }
              
              if (snapshotData.data.emails && Array.isArray(snapshotData.data.emails[0])) {
                this.emails = snapshotData.data.emails[0];
              }
            } else {
              console.log(`[createEmailTMail] Snapshot không có email, snapshotData.data:`, snapshotData.data);
            }
          } catch (e) {
            console.log(`[createEmailTMail] Error parsing snapshot:`, e.message);
            console.log(`[createEmailTMail] Snapshot raw:`, component.snapshot.substring(0, 200));
            console.log(`[createEmailTMail] Using newEmail: ${newEmail}`);
            this.currentEmail = newEmail;
            if (!this.emails.includes(this.currentEmail)) {
              this.emails.push(this.currentEmail);
            }
          }
        } else {
          console.log(`[createEmailTMail] No snapshot in response, component:`, JSON.stringify(component).substring(0, 300));
          console.log(`[createEmailTMail] Using newEmail: ${newEmail}`);
          this.currentEmail = newEmail;
          if (!this.emails.includes(this.currentEmail)) {
            this.emails.push(this.currentEmail);
          }
        }
      } else {
        console.log(`[createEmailTMail] No components in response, response:`, JSON.stringify(response).substring(0, 300));
        // Fallback: dùng newEmail nếu không có response
        this.currentEmail = newEmail;
        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }
      }

      if (response.components && response.components[0] && response.components[0].effects && response.components[0].effects.redirect) {
        // Redirect được xử lý tự động
      }

      // Fallback: Nếu vẫn không có email, dùng newEmail
      if (!this.currentEmail) {
        console.log(`[createEmailTMail] Fallback: Using newEmail: ${newEmail}`);
        this.currentEmail = newEmail;
        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }
      }

      // BƯỚC 3: Gọi syncEmail + fetchMessages
      console.log(`[createEmailTMail] Before syncAndFetchAfterCreate - currentEmail: ${this.currentEmail}`);
      await this.syncAndFetchAfterCreate();
      console.log(`[createEmailTMail] After syncAndFetchAfterCreate - currentEmail: ${this.currentEmail}`);

      if (selectedDomain !== this.domain) {
        this.domain = selectedDomain;
      }

      // Đảm bảo có email trước khi return
      const finalEmail = this.currentEmail || newEmail;
      if (!this.currentEmail) {
        this.currentEmail = finalEmail;
        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }
      }

      return {
        success: true,
        email: finalEmail,
        message: `Email tạm đã được tạo: ${finalEmail}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Sync email và fetch messages sau khi tạo email
   * Hỗ trợ tmail và tempmail-id
   */
  async syncAndFetchAfterCreate() {
    // QUAN TRỌNG: Chỉ sync nếu có email và snapshot đã sẵn sàng
    if (!this.currentEmail) {
      console.warn('⚠️  Không có email để sync, bỏ qua syncAndFetchAfterCreate');
      return;
    }
    
    // Kiểm tra snapshot có sẵn sàng không (chỉ cho TMail)
    if (this.sourceId === 'tmail' && this.client) {
      if (!this.client.componentSnapshots || !this.client.componentSnapshots.app) {
        console.warn('⚠️  Snapshot chưa sẵn sàng, bỏ qua syncAndFetchAfterCreate');
        return;
      }
    }

    if (this.sourceId === 'imail') {
      // iMail đã bị vô hiệu hóa
      return;
    }

    // TMail: Gộp syncEmail + fetchMessages thành 1 request
    const actionsSnapshot = this.client.getSnapshot(
      'frontend.actions',
      this.currentEmail,
      this.emails
    );

    const appSnapshot = this.client.getSnapshot(
      'frontend.app',
      this.currentEmail,
      this.emails
    );

    const payload = {
      components: [
        {
          snapshot: actionsSnapshot,
          calls: [
            {
              path: '',
              method: '__dispatch',
              params: ['syncEmail', { email: this.currentEmail }]
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
              params: ['syncEmail', { email: this.currentEmail }]
            },
            {
              path: '',
              method: '__dispatch',
              params: ['fetchMessages', {}]
            }
          ],
          updates: {
            email: this.currentEmail
          }
        }
      ]
    };

    try {
      console.log(`[syncAndFetchAfterCreate] Sending sync request for email: ${this.currentEmail}`);
      const response = await this.client.sendRequest(payload);
      console.log(`[syncAndFetchAfterCreate] Sync completed. Response has ${response?.components?.length || 0} components`);
      
      // QUAN TRỌNG: Verify snapshot đã được update với email mới
      if (response?.components) {
        response.components.forEach((comp, idx) => {
          if (comp.snapshot) {
            try {
              const snap = typeof comp.snapshot === 'string' ? JSON.parse(comp.snapshot) : comp.snapshot;
              if (snap.memo?.name === 'frontend.app' && snap.data?.email) {
                console.log(`[syncAndFetchAfterCreate] Component ${idx} (app) snapshot email: ${snap.data.email}`);
                // Verify snapshot trong client đã được update
                if (this.client.componentSnapshots.app?.data?.email) {
                  console.log(`[syncAndFetchAfterCreate] Client app snapshot email: ${this.client.componentSnapshots.app.data.email}`);
                }
              }
            } catch (e) {
              // Ignore
            }
          }
        });
      }
    } catch (error) {
      console.error('[syncAndFetchAfterCreate] Lỗi sync email:', error.message);
    }
  }

  /**
   * Sync email khi reload (giống server gốc: gọi syncEmail trước khi fetchMessages)
   * Hỗ trợ TMail, tempmail-id và noopmail
   */
  async syncEmailOnReload() {
    if (!this.currentEmail) {
      return;
    }

    // iMail đã bị vô hiệu hóa
    if (this.sourceId === 'imail') {
      return;
    }

    // NoopMail: Set current email trong client
    if (this.sourceId === 'noopmail') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        this.client.setCurrentEmail(this.currentEmail);
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // TempMail ID: Lấy emailId từ danh sách emails khi reload
    if (this.sourceId === 'tempmail-id') {
      if (this.client && this.currentEmail) {
        try {
          // Set currentEmail vào client
          this.client.currentEmail = this.currentEmail;
          
          // Lấy emailId từ danh sách emails
          const emailId = await this.client.getEmailIdFromEmail(this.currentEmail);
          if (emailId) {
            this.client.currentEmailId = emailId;
          }
        } catch (error) {
          // Ignore error, fetch messages sẽ tự xử lý
          // Không throw error, để fetch messages tự xử lý
        }
      }
      return;
    }

    // TMail: Sync email với snapshot
    if (this.sourceId !== 'tmail') {
      return;
    }

    // QUAN TRỌNG: Nếu client chưa được init, cần init trước
    if (!this.client) {
      console.log('⚠️  Client chưa được init, đang init...');
      try {
        await this.init(this.sourceId);
      } catch (error) {
        console.error('Lỗi khi init client:', error.message);
        throw new Error(`Không thể khởi tạo client: ${error.message}`);
      }
    }

    // Kiểm tra snapshot có sẵn sàng không
    if (!this.client || !this.client.componentSnapshots || !this.client.componentSnapshots.app) {
      console.warn('⚠️  Snapshot chưa sẵn sàng sau khi init, không thể sync email');
      // QUAN TRỌNG: Throw error để frontend biết sync không thành công và tạo email mới
      // Nhưng error message phải rõ ràng
      throw new Error('Session đã hết hạn. Vui lòng tạo email mới.');
    }

    // QUAN TRỌNG: Khi reload, snapshot từ HTML có email = null
    // Không override email trong snapshot, giữ nguyên để checksum khớp
    // Server sẽ tự cập nhật email sau khi syncEmail thành công
    const actionsSnapshot = this.client.getSnapshot(
      'frontend.actions',
      null, // Không override email, giữ nguyên email trong snapshot (có thể là null)
      this.emails.length > 0 ? this.emails : null
    );

    const appSnapshot = this.client.getSnapshot(
      'frontend.app',
      null, // Không override email, giữ nguyên email trong snapshot (có thể là null)
      this.emails.length > 0 ? this.emails : null
    );

    const payload = {
      components: [
        {
          snapshot: actionsSnapshot,
          calls: [
            {
              path: '',
              method: '__dispatch',
              params: ['syncEmail', { email: this.currentEmail }]
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
              params: ['syncEmail', { email: this.currentEmail }]
            },
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
      await this.client.sendRequest(payload);
      console.log('✓ TMail: Email đã được sync khi reload');
    } catch (error) {
      console.error('Lỗi sync email khi reload:', error.message);
      // QUAN TRỌNG: Không throw error, để frontend có thể tạo email mới
      // Nếu throw error, frontend sẽ nhận 500 và không thể xử lý
      // Thay vào đó, return để frontend biết sync không thành công và tạo email mới
      throw error;
    }
  }

  /**
   * Sync email và fetch messages sau khi xóa email (chuyển sang email khác)
   */
  async syncAndFetchAfterDelete(newEmail) {
    if (!newEmail) return;

    const actionsSnapshot = this.client.getSnapshot(
      'frontend.actions',
      newEmail,
      this.emails
    );

    const appSnapshot = this.client.getSnapshot(
      'frontend.app',
      newEmail,
      this.emails
    );

    // Giống API gốc: gọi syncEmail cho cả 2 components
    const payload = {
      components: [
        {
          snapshot: actionsSnapshot,
          calls: [
            {
              path: '',
              method: '__dispatch',
              params: ['syncEmail', { email: newEmail }]
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
              params: ['syncEmail', { email: newEmail }]
            },
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
      await this.client.sendRequest(payload);
    } catch (error) {
      console.error('Lỗi sync email sau khi xóa:', error.message);
    }
  }

  /**
   * Tạo email ngẫu nhiên
   * Hỗ trợ tmail, tempmail-id và noopmail
   */
  async createRandomEmail() {
    if (this.sourceId === 'imail') {
      return {
        success: false,
        error: 'iMail source đã bị vô hiệu hóa do không ổn định'
      };
    }
    
    if (this.sourceId === 'tempmail-id' || this.sourceId === 'noopmail') {
      // TempMail ID: Gọi trực tiếp method createRandomEmail
      try {
        console.log(`[createRandomEmail] ${this.sourceId}: Starting...`);
        
        // QUAN TRỌNG: Đảm bảo client đã được init trước khi tạo email
        if (!this.client) {
          console.log(`[createRandomEmail] ${this.sourceId}: Client chưa init, đang init...`);
          await this.init(this.sourceId);
        }
        
        const result = await this.client.createRandomEmail();
        console.log(`[createRandomEmail] ${this.sourceId}: Result: ${result.success ? 'success' : 'failed'}, Email: ${result.email || 'null'}`);
        
        if (result.success) {
          this.currentEmail = result.email;
          if (!this.emails.includes(this.currentEmail)) {
            this.emails.push(this.currentEmail);
          }
          
          // Update emails list từ client
          try {
            const allEmails = this.client.getAllEmails();
            if (allEmails && allEmails.length > 0) {
              this.emails = allEmails;
            }
          } catch (e) {
            console.warn(`[createRandomEmail] ${this.sourceId}: Không thể lấy danh sách emails:`, e.message);
          }
        }
        
        return result;
      } catch (error) {
        console.error(`[createRandomEmail] ${this.sourceId}: Error:`, error.message);
        console.error(`[createRandomEmail] ${this.sourceId}: Stack:`, error.stack);
        return {
          success: false,
          error: error.message
        };
      }
    } else {
      // TMail: Tạo username random và gọi createEmail
      try {
        // QUAN TRỌNG: Đảm bảo client đã được init trước khi tạo email
        // Check trực tiếp trong sourceManager để tránh throw error từ getter
        const currentSource = this.sourceManager.currentSource;
        const source = this.sourceManager.sources[currentSource || this.sourceId];
        if (!source || !source.client) {
          console.log(`[createRandomEmail] ${this.sourceId}: Client chưa init, đang init...`);
          await this.init(this.sourceId);
        }
        
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        let randomUsername = (timestamp + random).substring(0, 15);
        
        if (randomUsername.length < 3) {
          randomUsername = randomUsername + 'a'.repeat(3 - randomUsername.length);
        }
        
        return await this.createEmail(randomUsername);
      } catch (error) {
        console.error(`[createRandomEmail] ${this.sourceId}: Error:`, error.message);
        return {
          success: false,
          error: error.message
        };
      }
    }
  }

  /**
   * Lấy danh sách thư trong hộp thư
   * Hỗ trợ tmail, tempmail-id và noopmail
   */
  async fetchMessages() {
    if (!this.currentEmail) {
      // Trả về success với messages rỗng thay vì lỗi để nhất quán
      return {
        success: true,
        messages: [],
        count: 0
      };
    }

    // Xử lý theo nguồn mail
    if (this.sourceId === 'imail') {
      return {
        success: false,
        error: 'iMail source đã bị vô hiệu hóa do không ổn định',
        messages: [],
        count: 0
      };
    } else if (this.sourceId === 'tempmail-id') {
      return await this.fetchMessagesTempMailID();
    } else if (this.sourceId === 'noopmail') {
      return await this.fetchMessagesNoopMail();
    } else {
      return await this.fetchMessagesTMail();
    }
  }

  /**
   * Fetch messages cho iMail
   */
  async fetchMessagesIMail() {
    try {
      // QUAN TRỌNG: Sync email trước khi fetch messages
      // Để server biết email nào đang được dùng
      if (this.currentEmail && this.client && typeof this.client.syncEmail === 'function') {
        try {
          await this.client.syncEmail(this.currentEmail);
        } catch (syncError) {
          console.warn('⚠️ Lỗi sync email (có thể không ảnh hưởng):', syncError.message);
          // Tiếp tục fetch messages dù sync lỗi
        }
      }
      
      const result = await this.client.fetchMessages();
      
      if (result.success) {
        // Format messages để đồng nhất với TMail format
        const formattedMessages = result.messages.map((msg, index) => ({
          id: msg.id || `msg-${index}`,
          subject: msg.subject || 'Không có tiêu đề',
          sender_name: msg.sender_name || 'Không rõ',
          sender_email: msg.sender_email || '',
          date: msg.date || null,
          datediff: msg.datediff || null,
          timestamp: msg.timestamp || null,
          content: this.formatEmailContent(msg.content || ''),
          content_raw: msg.content_raw || msg.content || '',
          attachments: msg.attachments || []
        }));
        
        return {
          success: true,
          messages: formattedMessages,
          count: formattedMessages.length
        };
      }
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Bắt đầu polling để check mail mới (đã bị vô hiệu hóa cùng với iMail)
   * @param {number} interval - Khoảng thời gian giữa các lần gọi (ms), mặc định 3000ms
   * @param {Function} callback - Callback được gọi mỗi khi có kết quả fetchMessages
   */
  startPolling(interval = 3000, callback = null) {
    // iMail đã bị vô hiệu hóa
    console.log('⚠️ Polling đã bị vô hiệu hóa cùng với iMail source');
  }

  /**
   * Dừng polling
   */
  stopPolling() {
    // iMail đã bị vô hiệu hóa
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

    // TempMail ID và NoopMail: Gọi API để lấy chi tiết message
    if ((this.sourceId === 'tempmail-id' || this.sourceId === 'noopmail') && this.client && typeof this.client.getMessageDetail === 'function') {
      return await this.client.getMessageDetail(messageId);
    }

    // TMail: Trả về message từ danh sách (đã có content)
    // Tìm message trong danh sách hiện tại
    const messagesResult = await this.fetchMessages();
    if (messagesResult.success && messagesResult.messages) {
      const message = messagesResult.messages.find(msg => msg.id === messageId);
      if (message) {
        return {
          success: true,
          content: message.content || message.content_raw || '',
          content_raw: message.content_raw || message.content || '',
          subject: message.subject || '',
          from: message.sender_email || message.sender_name || '',
          to: message.to || this.currentEmail || '',
          date: message.date || null
        };
      }
    }

    return {
      success: false,
      error: 'Không tìm thấy message hoặc không hỗ trợ lấy chi tiết message cho nguồn này'
    };
  }

  /**
   * Fetch messages cho TempMail ID
   */
  async fetchMessagesTempMailID() {
    try {
      // Đảm bảo client có currentEmail được set
      if (this.currentEmail && this.client.currentEmail !== this.currentEmail) {
        this.client.currentEmail = this.currentEmail;
      }
      
      // Client sẽ tự động lấy emailId nếu chưa có trong fetchMessages()
      const result = await this.client.fetchMessages();
      
      if (result.success) {
        // Format messages để đồng nhất với TMail format
        const formattedMessages = result.messages.map((msg, index) => ({
          id: msg.id || `msg-${index}`,
          subject: msg.subject || 'Không có tiêu đề',
          sender_name: msg.sender_name || 'Không rõ',
          sender_email: msg.sender_email || '',
          date: msg.date || null,
          datediff: msg.datediff || null,
          timestamp: msg.timestamp || null,
          content: this.formatEmailContent(msg.content || ''),
          content_raw: msg.content_raw || msg.content || '',
          attachments: msg.attachments || []
        }));
        
        return {
          success: true,
          messages: formattedMessages,
          count: formattedMessages.length
        };
      }
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Fetch messages cho NoopMail
   */
  async fetchMessagesNoopMail() {
    try {
      // Đảm bảo client có currentEmail được set
      if (this.currentEmail && this.client) {
        this.client.setCurrentEmail(this.currentEmail);
      }
      
      const result = await this.client.fetchMessages();
      
      if (result.success) {
        // Format messages đã được xử lý trong client, chỉ cần return
        return result;
      }
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Fetch messages cho TMail
   */
  async fetchMessagesTMail() {
    // Debug: Log email hiện tại
    console.log(`[fetchMessagesTMail] Current email: ${this.currentEmail || 'null'}, Emails list: ${this.emails.length}`);
    
    const snapshot = this.client.getSnapshot(
      'frontend.app',
      this.currentEmail,
      this.emails
    );

    const payload = {
      components: [
        {
          snapshot: snapshot,
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
      const response = await this.client.sendRequest(payload);
      
      let messages = [];
      if (response.components && response.components[0]) {
        const component = response.components[0];
        
        if (component.snapshot) {
          try {
            const snapshotData = JSON.parse(component.snapshot);
            if (snapshotData.data && snapshotData.data.messages) {
              // messages có structure: [[message1, message2, ...], {s: "arr"}]
              const messagesArray = snapshotData.data.messages[0] || [];
              
              console.log(`📬 Found ${messagesArray.length} items in messages array`);
              
              // Flatten nested arrays nếu có
              let flatMessages = [];
              for (const item of messagesArray) {
                if (Array.isArray(item)) {
                  // Nested array - flatten
                  console.log(`  → Found nested array with ${item.length} items`);
                  flatMessages = flatMessages.concat(item);
                } else if (item && typeof item === 'object') {
                  if (item.id) {
                    // Direct message object
                    flatMessages.push(item);
                  } else {
                    // Object nhưng không phải message (có thể là metadata)
                    console.log(`  ⚠️ Skipping non-message object:`, Object.keys(item));
                  }
                }
              }
              
              console.log(`📦 Flattened to ${flatMessages.length} messages`);
              
              // Parse từng message để lấy thông tin đầy đủ và format HTML
              messages = flatMessages
                .filter(msg => msg && typeof msg === 'object' && msg.id) // Chỉ lấy message có id
                .map((msg, index) => {
                  const parsed = {
                    id: msg.id || null,
                    subject: msg.subject || 'Không có tiêu đề',
                    sender_name: msg.sender_name || 'Không rõ',
                    sender_email: msg.sender_email || '',
                    date: msg.date || null,
                    datediff: msg.datediff || null,
                    timestamp: msg.timestamp ? (Array.isArray(msg.timestamp) ? msg.timestamp[0] : msg.timestamp) : null,
                    content: this.formatEmailContent(msg.content || ''), // Format HTML
                    content_raw: msg.content || '', // Giữ nguyên raw HTML
                    attachments: msg.attachments ? (Array.isArray(msg.attachments) ? (Array.isArray(msg.attachments[0]) ? msg.attachments[0] : msg.attachments) : []) : []
                  };
                  
                  // Debug log cho message đầu tiên
                  if (index === 0) {
                    console.log(`✓ Sample parsed message:`, {
                      id: parsed.id,
                      subject: parsed.subject,
                      sender: parsed.sender_name,
                      hasContent: !!parsed.content,
                      contentLength: parsed.content.length,
                      rawContentLength: parsed.content_raw.length
                    });
                  }
                  
                  return parsed;
                });
              
              console.log(`✅ Successfully parsed ${messages.length} messages`);
            } else {
              console.log('⚠️ No messages found in snapshot data');
            }
          } catch (e) {
            console.error('Lỗi parse messages:', e.message);
            console.error('Stack:', e.stack);
          }
        }
      }

      return {
        success: true,
        messages: messages,
        count: messages.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Format HTML email content để dễ đọc hơn
   * Loại bỏ các thẻ không cần thiết, giữ lại nội dung chính và links
   */
  formatEmailContent(html) {
    if (!html || typeof html !== 'string') return '';
    
    try {
      const $ = cheerio.load(html);
      
      // Loại bỏ các thẻ không cần thiết
      $('script, style, noscript, meta, link[rel="stylesheet"]').remove();
      
      // Loại bỏ tracking pixels và images ẩn
      $('img[width="1"][height="1"], img[style*="display:none"], img[style*="display: none"]').remove();
      
      // Giữ lại các phần quan trọng:
      // - Nội dung text
      // - Links và buttons
      // - Images quan trọng (logo, icons)
      // - Verification codes (thường trong thẻ p, div, span với số)
      
      // Lấy body content
      let body = $('body').length ? $('body') : $('html');
      if (!body.length) body = cheerio.load('<div>' + html + '</div>')('div');
      
      // Giữ lại các elements quan trọng
      const importantSelectors = [
        'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'button', 'input[type="submit"]',
        'table', 'tr', 'td',
        'img:not([width="1"]):not([height="1"])',
        'strong', 'b', 'em', 'i', 'u'
      ];
      
      // Clean up và format
      body.find('*').each(function() {
        const $el = $(this);
        const el = $el.get(0);
        
        if (!el || !el.attribs) return;
        
        // Giữ lại attributes quan trọng
        const importantAttrs = ['href', 'src', 'alt', 'title'];
        const removeAttrs = [];
        
        Object.keys(el.attribs).forEach(attr => {
          if (!importantAttrs.includes(attr) && !attr.startsWith('data-')) {
            removeAttrs.push(attr);
          }
        });
        
        removeAttrs.forEach(attr => $el.removeAttr(attr));
        
        // Clean inline styles (giữ lại colors, font-size cho verification codes)
        const style = $el.attr('style');
        if (style) {
          const keepStyles = ['color', 'font-size', 'font-weight', 'background-color', 'background'];
          const newStyle = style.split(';')
            .filter(s => {
              const prop = s.split(':')[0].trim().toLowerCase();
              return keepStyles.some(k => prop.includes(k));
            })
            .join(';');
          if (newStyle) {
            $el.attr('style', newStyle);
          } else {
            $el.removeAttr('style');
          }
        }
      });
      
      // Lấy nội dung đã clean
      let formatted = body.html() || body.text();
      
      // Decode HTML entities
      formatted = formatted
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      
      // Clean up whitespace
      formatted = formatted.replace(/\s+/g, ' ').trim();
      
      // Nếu quá ngắn hoặc chỉ có HTML tags, trả về text content
      if (formatted.length < 50 || !formatted.includes('<')) {
        const textOnly = body.text().trim();
        return textOnly || html.substring(0, 500); // Fallback
      }
      
      return formatted;
    } catch (e) {
      console.error('Lỗi format email content:', e.message);
      // Fallback: strip HTML tags và trả về text
      return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  /**
   * Đổi domain
   */
  async setDomain(domain) {
    if (!CONFIG.DOMAINS.includes(domain)) {
      return {
        success: false,
        error: 'Domain không hợp lệ'
      };
    }

    this.domain = domain;
    return {
      success: true,
      domain: domain
    };
  }

  /**
   * Xóa email hiện tại
   */
  async deleteEmail() {
    if (!this.currentEmail) {
      return {
        success: false,
        error: 'Chưa có email nào được chọn'
      };
    }

    const snapshot = this.client.getSnapshot(
      'frontend.actions',
      this.currentEmail,
      this.emails
    );

    const payload = {
      components: [
        {
          snapshot: snapshot,
          calls: [
            {
              path: '',
              method: 'deleteEmail',
              params: []
            }
          ],
          updates: {}
        }
      ]
    };

    try {
      const response = await this.client.sendRequest(payload);
      
      // Parse response để lấy email mới (nếu còn email trong danh sách)
      const deletedEmail = this.currentEmail;
      let newEmail = null;
      
      if (response.components && response.components[0]) {
        const component = response.components[0];
        
        // Check redirect (nếu có)
        if (component.effects && component.effects.redirect) {
          console.log(`\n⚠️  DeleteEmail có redirect đến: ${component.effects.redirect}`);
          console.log('   Fetching HTML từ redirect URL để lấy snapshot mới...\n');
          
          // Fetch HTML từ redirect URL để lấy snapshot mới
          // QUAN TRỌNG: skipActions = false để parse actions snapshot và lấy email mới!
          await this.client.fetchAndUpdateSnapshots(component.effects.redirect, { skipActions: false });
          
          // Parse actions snapshot từ HTML để lấy email mới
          const actionsSnapshot = this.client.componentSnapshots.actions;
          if (actionsSnapshot && actionsSnapshot.data) {
            // Update emails list từ actions snapshot
            if (actionsSnapshot.data.emails && Array.isArray(actionsSnapshot.data.emails[0])) {
              this.emails = actionsSnapshot.data.emails[0];
            }
            
            // Update currentEmail từ actions snapshot (email mới sau khi xóa)
            if (actionsSnapshot.data.email) {
              newEmail = actionsSnapshot.data.email;
              this.currentEmail = newEmail;
              console.log(`✓ Lấy email mới từ actions snapshot: ${newEmail}`);
            }
          }
        }
        
        // Nếu chưa có newEmail từ redirect, parse từ response snapshot
        if (!newEmail && component.snapshot) {
          try {
            const snapshotData = JSON.parse(component.snapshot);
            
            // Update emails list từ snapshot
            if (snapshotData.data && snapshotData.data.emails && Array.isArray(snapshotData.data.emails[0])) {
              this.emails = snapshotData.data.emails[0];
            } else {
              // Fallback: xóa email khỏi danh sách local
              this.emails = this.emails.filter(e => e !== deletedEmail);
            }
            
            // Update currentEmail từ snapshot (backend tự động chuyển sang email khác nếu còn)
            if (snapshotData.data && snapshotData.data.email) {
              newEmail = snapshotData.data.email;
              this.currentEmail = newEmail;
            } else {
              // Không còn email nào
              this.currentEmail = null;
            }
          } catch (e) {
            // Fallback: xóa email khỏi danh sách local
            this.emails = this.emails.filter(e => e !== deletedEmail);
      this.currentEmail = this.emails[this.emails.length - 1] || null;
            newEmail = this.currentEmail;
          }
        }
      }
      
      // QUAN TRỌNG: Nếu có email mới, gọi syncEmail giống API gốc!
      if (newEmail && newEmail !== deletedEmail) {
        console.log(`🔄 Email đã xóa, tự động chuyển sang: ${newEmail}`);
        console.log('   Gọi syncEmail để sync email mới...\n');
        
        await this.syncAndFetchAfterDelete(newEmail);
      }

      return {
        success: true,
        message: `Đã xóa email: ${deletedEmail}`,
        newEmail: this.currentEmail || null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Parse email từ HTML response
   */
  parseEmailFromHtml(html) {
    try {
      const $ = cheerio.load(html);
      const emailText = $('#email_id').text().trim();
      if (emailText && emailText.includes('@')) {
        return emailText;
      }
    } catch (e) {
      console.error('Lỗi parse email từ HTML');
    }
    return null;
  }

  /**
   * Lấy danh sách domains có sẵn
   */
  getDomains() {
    return this.sourceManager.getCurrentDomains();
  }

  /**
   * Lấy danh sách tất cả nguồn mail
   */
  getAllSources() {
    return this.sourceManager.getAllSources();
  }

  /**
   * Lấy thông tin nguồn hiện tại
   */
  getCurrentSourceInfo() {
    return this.sourceManager.getCurrentSourceInfo();
  }

  /**
   * Lấy email hiện tại
   */
  getCurrentEmail() {
    return this.currentEmail;
  }

  /**
   * Lấy tất cả emails đã tạo
   */
  getAllEmails() {
    return this.emails;
  }
}

