import { MailSourceManager } from './mail-source-manager.js';
import { CONFIG } from './config.js';
import * as cheerio from 'cheerio';

/**
 * TempMail Service
 * Cung cấp các chức năng chính cho temp mail
 * Hỗ trợ nhiều nguồn mail khác nhau
 */
export class TempMail {
  constructor(sourceId = 'noopmail') {
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
    // eTempMail không cần username (có thể để null để random)
    if (this.sourceId !== 'etempmail') {
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

    // Chặn domain rác: null / "null" / "undefined" / rỗng (gây email user@null)
    const isValidDomain = (d) => {
      if (d == null) return false;
      const s = String(d).trim();
      if (!s || s === 'null' || s === 'undefined' || s === 'None') return false;
      return s.includes('.') && s.length >= 3;
    };
    if (!isValidDomain(domain)) {
      domain = null;
    } else {
      domain = String(domain).trim();
    }
    if (!isValidDomain(this.domain)) {
      this.domain = this.sourceManager.getCurrentDefaultDomain()
        || (this.sourceManager.getCurrentDomains() || [])[0]
        || null;
      if (!isValidDomain(this.domain)) this.domain = null;
    }

    // Chọn domain: Ưu tiên domain truyền vào, nếu không có thì dùng default
    const availableDomains = this.sourceManager.getCurrentDomains();
    let selectedDomain = (domain && availableDomains.includes(domain)) ? domain : this.domain;
    // NoopMail: domain list động qua /api/rd — cho phép domain hợp lệ dù chưa có trong list
    if (!isValidDomain(selectedDomain) && isValidDomain(domain)) {
      selectedDomain = domain;
    }
    if (!isValidDomain(selectedDomain)) {
      selectedDomain = null;
    }

    // Xử lý theo nguồn mail
    if (this.sourceId === 'imail') {
      return {
        success: false,
        error: 'iMail source đã bị vô hiệu hóa do không ổn định'
      };
    } else if (this.sourceId === 'noopmail') {
      return await this.createEmailNoopMail(username, selectedDomain);
    } else if (this.sourceId === 'temporarymail') {
      return await this.createEmailTemporaryMail(username, selectedDomain);
    } else if (this.sourceId === 'mailio') {
      return await this.createEmailMailIO(username, selectedDomain);
    } else if (this.sourceId === 'etempmail') {
      return await this.createEmailETempMail(username, selectedDomain);
    } else if (this.sourceId === 'priyo') {
      return await this.createEmailPriyo(username, selectedDomain);
    } else if (this.sourceId === 'pmail') {
      return await this.createEmailPMail(username, selectedDomain);
    } else if (this.sourceId === 'tinyhost') {
      return await this.createEmailTinyHost(username, selectedDomain);
    } else if (this.sourceId === 'edumail') {
      return await this.createEmailEduMail(username, selectedDomain);
    } else if (this.sourceId === 'apple') {
      return await this.createEmailApple(username, selectedDomain);
    } else if (this.sourceId === 'generatoremail') {
      return await this.createEmailGeneratorEmail(username, selectedDomain);
    } else if (this.sourceId === 'moakt') {
      return await this.createEmailMoakt(username, selectedDomain);
    } else if (this.sourceId === 'tempmailapi') {
      return await this.createEmailTempMailApi(username, selectedDomain);
    } else if (this.sourceId === 'inboxes') {
      return await this.createEmailInboxes(username, selectedDomain);
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
   * Tạo email cho nguồn NoopMail
   */
  async createEmailNoopMail(username, domain) {
    try {
      // Đảm bảo client đã init + có domain (tránh user@null)
      if (!this.client) {
        await this.init('noopmail');
      }
      const result = await this.client.createEmail(username, domain);

      if (result.success) {
        // Chặn response domain rác
        if (!result.domain || result.domain === 'null' || String(result.email || '').endsWith('@null')) {
          return {
            success: false,
            error: 'NoopMail trả domain không hợp lệ, thử lại'
          };
        }
        this.currentEmail = result.email;
        this.domain = result.domain;
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
      // Lỗi tạo email NoopMail
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn TemporaryMail
   */
  async createEmailTemporaryMail(username, domain) {
    try {
      const result = await this.client.createEmail(username, domain);

      if (result.success) {
        this.currentEmail = result.email;
        // Lưu secretKey vào client để dùng cho fetchMessages
        if (result.secretKey) {
          this.client.secretKey = result.secretKey;
        }

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          domain: result.domain,
          secretKey: result.secretKey
        };
      }

      // Xử lý các lỗi đặc biệt với thông báo tiếng Việt
      if (result.code === 403) {
        return {
          success: false,
          error: 'Email này đã được người dùng khác sử dụng và sẽ được mở khóa sau 14 ngày kể từ lần sử dụng cuối. Vui lòng chọn tên người dùng khác.',
          code: 403
        };
      }

      // DISABLED: Bỏ rate limit check
      // if (result.code === 429) {
      //   return {
      //     success: false,
      //     error: 'Bạn đã tạo quá nhiều email. Vui lòng thử lại sau.',
      //     code: 429
      //   };
      // }

      // Các lỗi khác: giữ nguyên thông báo từ API hoặc dịch sang tiếng Việt
      let errorMessage = result.error || 'Không thể tạo email';
      if (result.error && result.error.includes('reserved')) {
        errorMessage = 'Email này đã được người dùng khác sử dụng. Vui lòng chọn tên người dùng khác.';
      }

      return {
        success: false,
        error: errorMessage,
        code: result.code
      };
    } catch (error) {
      // Lỗi tạo email TemporaryMail
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn MailIO
   */
  async createEmailMailIO(username, domain) {
    try {
      const result = await this.client.createEmail(username, domain);

      if (result.success) {
        this.currentEmail = result.email;
        // Lưu token vào client để dùng cho delete email
        if (result.token) {
          this.client.token = result.token;
        }

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          domain: result.domain,
          token: result.token
        };
      }

      // Xử lý các lỗi đặc biệt với thông báo tiếng Việt
      if (result.code === 403) {
        return {
          success: false,
          error: 'Email này đã được người dùng khác sử dụng. Vui lòng chọn tên người dùng khác.',
          code: 403
        };
      }

      // DISABLED: Bỏ rate limit check
      // if (result.code === 429) {
      //   return {
      //     success: false,
      //     error: 'Bạn đã tạo quá nhiều email. Vui lòng thử lại sau.',
      //     code: 429
      //   };
      // }

      return {
        success: false,
        error: result.error || 'Không thể tạo email',
        code: result.code
      };
    } catch (error) {
      // Lỗi tạo email MailIO
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn eTempMail
   * Lưu ý: eTempMail không cho user nhập username, luôn random
   * User chỉ có thể chọn domain
   */
  async createEmailETempMail(username, domain) {
    try {
      // eTempMail không cần username (luôn random) — chỉ chọn domain
      // Lưu ý: từ 2026 API bắt buộc Cloudflare Turnstile cf_token
      const result = await this.client.createEmail(null, domain);

      if (result.success) {
        // Double-check bot-block fake email
        const email = String(result.email || '').toLowerCase();
        if (
          email.includes('get-a-real-job') ||
          email.includes('never.gonna.give.you.up') ||
          email.includes('ip_logged')
        ) {
          return {
            success: false,
            error:
              'eTempMail chặn bot (Cloudflare Turnstile). Không thể tạo mail thật từ server — hãy dùng nguồn khác.',
            code: 'ETEMPMAIL_TURNSTILE_BLOCKED',
            blocked: true
          };
        }

        this.currentEmail = result.email;
        if (result.domain) this.domain = result.domain;

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          domain: result.domain,
          id: result.id,
          recover_key: result.recover_key,
          creation_time: result.creation_time
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email',
        code: result.code,
        blocked: result.blocked || false
      };
    } catch (error) {
      // Lỗi tạo email eTempMail
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn Priyo (priyo.email)
   */
  async createEmailPriyo(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

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

        // QUAN TRỌNG: Gộp syncEmail + fetchMessages trong 1 request (giống TMail)
        // Để đảm bảo server có đủ context và trả về messages ngay
        if (this.client && typeof this.client.syncEmailAndFetchMessages === 'function') {
          try {
            await this.client.syncEmailAndFetchMessages(this.currentEmail);
          } catch (error) {
            // Lỗi sync, nhưng email đã tạo thành công
            console.error('[TempMail] Error syncing email after create:', error.message);
          }
        } else {
          // Fallback: dùng syncEmail riêng nếu method không tồn tại
          await this.client.syncEmail(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn PMAIL (Mail Forward)
   */
  async createEmailPMail(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

      if (result.success) {
        this.currentEmail = result.email;

        // QUAN TRỌNG: Set email vào client để fetchMessages có thể dùng
        if (this.client && typeof this.client.setCurrentEmail === 'function') {
          this.client.setCurrentEmail(this.currentEmail);
        }

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn TinyHost
   */
  async createEmailTinyHost(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

      if (result.success) {
        this.currentEmail = result.email;

        // Set email vào client để fetchMessages có thể dùng
        if (this.client && typeof this.client.setCurrentEmail === 'function') {
          this.client.setCurrentEmail(this.currentEmail);
        }

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn EduMail (edumailfree.com)
   */
  async createEmailEduMail(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

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

        // Sync email sau khi tạo (giống TMail)
        await this.syncAndFetchAfterCreate();

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`,
          // QUAN TRỌNG: Trả về cookies để frontend lưu vào localStorage
          cookies: this.client.getCookiesForStorage()
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn Apple (apple.edu.pl)
   */
  async createEmailApple(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

      if (result.success) {
        this.currentEmail = result.email;

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`,
          token: result.token,
          expiresAt: result.expiresAt,
          // Trả về cookies để frontend lưu vào localStorage
          cookies: this.client.getCookiesForStorage()
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Tạo email cho nguồn GeneratorEmail (generator.email)
   */
  async createEmailGeneratorEmail(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

      if (result.success) {
        this.currentEmail = result.email;

        // Set email vào client để fetchMessages có thể dùng
        if (this.client && typeof this.client.setCurrentEmail === 'function') {
          this.client.setCurrentEmail(this.currentEmail);
        }

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
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
        // Error setting domain
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

      // Update email và emails từ response
      if (response.components && response.components[0]) {
        const component = response.components[0];

        if (component.snapshot) {
          try {
            const snapshotData = JSON.parse(component.snapshot);
            if (snapshotData.data && snapshotData.data.email) {
              const oldEmail = this.currentEmail;
              this.currentEmail = snapshotData.data.email;
              if (!this.emails.includes(this.currentEmail)) {
                this.emails.push(this.currentEmail);
              }

              if (snapshotData.data.emails && Array.isArray(snapshotData.data.emails[0])) {
                this.emails = snapshotData.data.emails[0];
              }
            }
          } catch (e) {
            this.currentEmail = newEmail;
            if (!this.emails.includes(this.currentEmail)) {
              this.emails.push(this.currentEmail);
            }
          }
        } else {
          this.currentEmail = newEmail;
          if (!this.emails.includes(this.currentEmail)) {
            this.emails.push(this.currentEmail);
          }
        }
      }

      if (response.components && response.components[0] && response.components[0].effects && response.components[0].effects.redirect) {
        // Redirect được xử lý tự động
      }

      // BƯỚC 3: Gọi syncEmail + fetchMessages
      await this.syncAndFetchAfterCreate();

      if (selectedDomain !== this.domain) {
        this.domain = selectedDomain;
      }

      return {
        success: true,
        email: this.currentEmail,
        message: `Email tạm đã được tạo: ${this.currentEmail}`
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
   * Hỗ trợ tmail và edumail
   */
  async syncAndFetchAfterCreate() {
    // QUAN TRỌNG: Chỉ sync nếu có email và snapshot đã sẵn sàng
    if (!this.currentEmail) {
      // Không có email để sync
      return;
    }

    // Kiểm tra snapshot có sẵn sàng không (chỉ cho TMail và EduMail)
    if ((this.sourceId === 'tmail' || this.sourceId === 'edumail') && this.client) {
      if (!this.client.componentSnapshots || !this.client.componentSnapshots.app) {
        // Snapshot chưa sẵn sàng
        return;
      }
    }

    if (this.sourceId === 'imail') {
      // iMail đã bị vô hiệu hóa
      return;
    }

    // Priyo: Sync email qua client method
    if (this.sourceId === 'priyo') {
      try {
        await this.client.syncEmail(this.currentEmail);
      } catch (error) {
        // Lỗi sync email
      }
      return;
    }

    // TMail và EduMail: Gộp syncEmail + fetchMessages thành 1 request
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
      const response = await this.client.sendRequest(payload);

      // QUAN TRỌNG: Verify snapshot đã được update với email mới
      if (response?.components) {
        response.components.forEach((comp, idx) => {
          if (comp.snapshot) {
            try {
              const snap = typeof comp.snapshot === 'string' ? JSON.parse(comp.snapshot) : comp.snapshot;
              if (snap.memo?.name === 'frontend.app' && snap.data?.email) {
                // Verify snapshot trong client đã được update
              }
            } catch (e) {
              // Ignore
            }
          }
        });
      }
    } catch (error) {
      // Lỗi sync email
    }
  }

  /**
   * Sync email khi reload (giống server gốc: gọi syncEmail trước khi fetchMessages)
   * Hỗ trợ TMail và noopmail
   */
  async syncEmailOnReload() {
    if (!this.currentEmail) {
      return;
    }

    // iMail đã bị vô hiệu hóa
    if (this.sourceId === 'imail') {
      return;
    }

    // Priyo: Giống TMail - gộp syncEmail + fetchMessages trong 1 request
    // QUAN TRỌNG: Không re-initialize nếu snapshot còn hợp lệ (giống TMail)
    if (this.sourceId === 'priyo') {
      console.log('[TempMail] ========== SYNC EMAIL ON RELOAD (PRIYO) START ==========');
      console.log('[TempMail] Current email:', this.currentEmail);

      // QUAN TRỌNG: Nếu client chưa được init, cần init trước
      if (!this.client) {
        try {
          await this.init(this.sourceId);
        } catch (error) {
          throw new Error(`Không thể khởi tạo client: ${error.message}`);
        }
      }

      // Kiểm tra snapshot có sẵn sàng không (giống TMail)
      if (!this.client || !this.client.componentSnapshots || !this.client.componentSnapshots.inboxMessage) {
        // Snapshot chưa sẵn sàng sau khi init
        // QUAN TRỌNG: Initialize để lấy snapshot
        console.log('[TempMail] Snapshot not ready, initializing...');
        await this.client.initialize();

        // Set email sau khi initialize
        if (this.currentEmail) {
          this.client.setCurrentEmail(this.currentEmail);
        }
      }

      // Gộp syncEmail + fetchMessages trong 1 request (giống TMail)
      if (this.client && typeof this.client.syncEmailAndFetchMessages === 'function') {
        try {
          const result = await this.client.syncEmailAndFetchMessages(this.currentEmail);
          console.log('[TempMail] syncEmailAndFetchMessages result:', result.success, 'messages:', result.count);
          console.log('[TempMail] ========== SYNC EMAIL ON RELOAD (PRIYO) END ==========');
          return { success: true, message: 'Email synced successfully' };
        } catch (error) {
          console.error('[TempMail] Error in syncEmailAndFetchMessages:', error.message);
          // Fallback: thử sync riêng
          if (this.client && typeof this.client.syncEmail === 'function') {
            await this.client.syncEmail(this.currentEmail);
          }
          return { success: true, message: 'Email synced (with error)' };
        }
      } else {
        // Fallback: dùng syncEmail riêng nếu method không tồn tại
        if (this.client && typeof this.client.syncEmail === 'function') {
          await this.client.syncEmail(this.currentEmail);
        }
        return { success: true, message: 'Email synced successfully' };
      }
    }

    // NoopMail: Set current email trong client
    if (this.sourceId === 'noopmail') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        this.client.setCurrentEmail(this.currentEmail);
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // TemporaryMail: Set current email và secretKey trong client
    if (this.sourceId === 'temporarymail') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        // Lấy secretKey từ client (đã được set từ server khi sync)
        // Server đã set this.client.secretKey trước khi gọi syncEmailOnReload()
        const secretKey = this.client.secretKey || (this.client.getSecretKey ? this.client.getSecretKey() : null);
        this.client.setCurrentEmail(this.currentEmail, secretKey);

        // Đảm bảo secretKey được set vào this.secretKey của client
        if (secretKey && !this.client.secretKey) {
          this.client.secretKey = secretKey;
        }
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // MailIO: Set current email và token trong client
    if (this.sourceId === 'mailio') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        // Lấy token từ client (đã được set từ server khi sync)
        const token = this.client.token || (this.client.getToken ? this.client.getToken() : null);
        this.client.setCurrentEmail(this.currentEmail, token);

        // Đảm bảo token được set vào this.token của client
        if (token && !this.client.token) {
          this.client.token = token;
        }
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // PMAIL: Set current email trong client
    if (this.sourceId === 'pmail') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        this.client.setCurrentEmail(this.currentEmail);
        console.log('[TempMail] PMAIL email set to:', this.currentEmail);
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // TinyHost: Set current email trong client
    if (this.sourceId === 'tinyhost') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        this.client.setCurrentEmail(this.currentEmail);
        console.log('[TempMail] TinyHost email set to:', this.currentEmail);
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // GeneratorEmail: Set current email trong client
    if (this.sourceId === 'generatoremail') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        this.client.setCurrentEmail(this.currentEmail);
        console.log('[TempMail] GeneratorEmail email set to:', this.currentEmail);
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // Moakt: Set current email trong client
    if (this.sourceId === 'moakt') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        this.client.setCurrentEmail(this.currentEmail);
        console.log('[TempMail] Moakt email set to:', this.currentEmail);
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // TempMailAPI: Set current email trong client
    if (this.sourceId === 'tempmailapi' || this.sourceId === 'inboxes') {
      if (this.client && typeof this.client.setCurrentEmail === 'function') {
        this.client.setCurrentEmail(this.currentEmail);
        console.log(`[TempMail] ${this.sourceId} email set to:`, this.currentEmail);
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // Apple: Set token và email trong client (giống MailIO)
    if (this.sourceId === 'apple') {
      if (this.client && typeof this.client.setToken === 'function') {
        // Lấy token từ client (đã được set từ server khi sync)
        const token = this.client.token || (this.client.getToken ? this.client.getToken() : null);
        this.client.setToken(token, this.currentEmail);
        console.log('[TempMail] Apple email set to:', this.currentEmail);
      }
      return { success: true, message: 'Email synced successfully' };
    }

    // EduMail: Hỗ trợ reload bằng cách restore cookies từ localStorage
    // Giống web gốc: cookies → GET /mailbox → syncEmail → fetchMessages
    if (this.sourceId === 'edumail') {
      console.log('[TempMail] ========== SYNC EMAIL ON RELOAD (EDUMAIL) START ==========');
      console.log('[TempMail] Current email:', this.currentEmail);

      // QUAN TRỌNG: Nếu client chưa được init, cần init trước
      if (!this.client) {
        try {
          await this.init(this.sourceId);
        } catch (error) {
          throw new Error(`Không thể khởi tạo client: ${error.message}`);
        }
      }

      // BƯỚC 1: Restore cookies từ localStorage (nếu có)
      // Cookies này được lưu khi tạo email, chứa session ID
      const savedCookies = this.client.savedCookies || null;
      if (savedCookies) {
        console.log('[TempMail] Restoring cookies from saved state...');
        this.client.setCookiesFromStorage(savedCookies);
      } else {
        console.log('[TempMail] No saved cookies, session expired');
        throw new Error('Session đã hết hạn. Vui lòng tạo email mới.');
      }

      // BƯỚC 2: Fetch HTML từ /mailbox để lấy snapshot (giống web gốc khi reload)
      console.log('[TempMail] Fetching /mailbox to get snapshots...');
      try {
        await this.client.fetchAndUpdateSnapshots('/mailbox', { skipActions: false });
      } catch (fetchError) {
        console.error('[TempMail] Error fetching /mailbox:', fetchError.message);
        throw new Error('Session đã hết hạn. Vui lòng tạo email mới.');
      }

      // BƯỚC 3: Kiểm tra snapshot có sẵn sàng không
      if (!this.client.componentSnapshots || !this.client.componentSnapshots.app) {
        console.log('[TempMail] Snapshot still not ready after fetch');
        throw new Error('Session đã hết hạn. Vui lòng tạo email mới.');
      }

      console.log('[TempMail] Snapshots ready, syncing email...');

      // BƯỚC 4: Gộp syncEmail + fetchMessages trong 1 request (giống TMail)
      const actionsSnapshot = this.client.getSnapshot(
        'frontend.actions',
        null,
        this.emails.length > 0 ? this.emails : null
      );

      const appSnapshot = this.client.getSnapshot(
        'frontend.app',
        null,
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
        console.log('[TempMail] ========== SYNC EMAIL ON RELOAD (EDUMAIL) END ==========');
        return { success: true, message: 'Email synced successfully' };
      } catch (error) {
        console.error('[TempMail] Error in syncEmailOnReload (EduMail):', error.message);
        throw error;
      }
    }

    // TMail: Sync email với snapshot
    if (this.sourceId !== 'tmail') {
      return;
    }

    // QUAN TRỌNG: Nếu client chưa được init, cần init trước
    if (!this.client) {
      try {
        await this.init(this.sourceId);
      } catch (error) {
        throw new Error(`Không thể khởi tạo client: ${error.message}`);
      }
    }

    // Kiểm tra snapshot có sẵn sàng không
    if (!this.client || !this.client.componentSnapshots || !this.client.componentSnapshots.app) {
      // Snapshot chưa sẵn sàng sau khi init
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
      // TMail: Email đã được sync khi reload
    } catch (error) {
      // Lỗi sync email khi reload
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
      // Lỗi sync email sau khi xóa
    }
  }

  /**
   * Tạo email ngẫu nhiên
   * Hỗ trợ tmail và noopmail
   */
  async createRandomEmail() {
    if (this.sourceId === 'imail') {
      return {
        success: false,
        error: 'iMail source đã bị vô hiệu hóa do không ổn định'
      };
    }

    if (this.sourceId === 'noopmail' || this.sourceId === 'mailio' || this.sourceId === 'temporarymail' || this.sourceId === 'priyo' || this.sourceId === 'apple' || this.sourceId === 'generatoremail' || this.sourceId === 'moakt' || this.sourceId === 'tempmailapi' || this.sourceId === 'inboxes' || this.sourceId === 'pmail') {
      // TempMail ID, NoopMail, MailIO, TemporaryMail, Priyo, Apple, GeneratorEmail, Moakt, TempMailAPI, Inboxes và PMAIL: Gọi trực tiếp method createRandomEmail
      try {
        // Starting createRandomEmail

        // QUAN TRỌNG: Đảm bảo client đã được init trước khi tạo email
        if (!this.client) {
          // Client chưa init, đang init
          await this.init(this.sourceId);
        }

        const result = await this.client.createRandomEmail();
        // createRandomEmail result

        if (result.success) {
          // Chuẩn hóa domain: nhiều client (inboxes, ...) chỉ trả email, không trả domain
          const emailStr = result.email ? String(result.email) : '';
          let domainFromResult = result.domain;
          if ((!domainFromResult || domainFromResult === 'null' || domainFromResult === 'undefined')
            && emailStr.includes('@')) {
            domainFromResult = emailStr.split('@').pop();
          }

          // Chỉ chặn case thật sự hỏng: thiếu email hoặc domain = null/"null"
          const domainBad = !domainFromResult
            || domainFromResult === 'null'
            || domainFromResult === 'undefined'
            || !String(domainFromResult).includes('.');
          if (!emailStr || !emailStr.includes('@') || emailStr.endsWith('@null') || domainBad) {
            return {
              success: false,
              error: 'Domain không hợp lệ, vui lòng thử lại'
            };
          }

          result.domain = domainFromResult;
          this.currentEmail = result.email;
          this.domain = domainFromResult;

          // MailIO, TemporaryMail và Apple: Lưu token/secretKey vào client
          if (this.sourceId === 'mailio' && result.token) {
            this.client.token = result.token;
          } else if (this.sourceId === 'temporarymail' && result.secretKey) {
            this.client.secretKey = result.secretKey;
          } else if (this.sourceId === 'apple' && result.token) {
            this.client.token = result.token;
          }

          if (!this.emails.includes(this.currentEmail)) {
            this.emails.push(this.currentEmail);
          }

          // Update emails list từ client (nếu có method getAllEmails)
          try {
            if (this.client.getAllEmails && typeof this.client.getAllEmails === 'function') {
              const allEmails = this.client.getAllEmails();
              if (allEmails && allEmails.length > 0) {
                this.emails = allEmails;
              }
            }
          } catch (e) {
            // Không thể lấy danh sách emails
          }
        }

        return result;
      } catch (error) {
        // createRandomEmail error
        return {
          success: false,
          error: error.message
        };
      }
    } else {
      // TMail và EduMail: Tạo username random và gọi createEmail
      try {
        // QUAN TRỌNG: Đảm bảo client đã được init trước khi tạo email
        // Check trực tiếp trong sourceManager để tránh throw error từ getter
        const currentSource = this.sourceManager.currentSource;
        const source = this.sourceManager.sources[currentSource || this.sourceId];
        if (!source || !source.client) {
          // Client chưa init, đang init
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
        // createRandomEmail error
        return {
          success: false,
          error: error.message
        };
      }
    }
  }

  /**
   * Lấy danh sách thư trong hộp thư
   * Hỗ trợ tmail và noopmail
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
    } else if (this.sourceId === 'noopmail') {
      return await this.fetchMessagesNoopMail();
    } else if (this.sourceId === 'temporarymail') {
      return await this.fetchMessagesTemporaryMail();
    } else if (this.sourceId === 'mailio') {
      return await this.fetchMessagesMailIO();
    } else if (this.sourceId === 'etempmail') {
      return await this.fetchMessagesETempMail();
    } else if (this.sourceId === 'priyo') {
      return await this.fetchMessagesPriyo();
    } else if (this.sourceId === 'pmail') {
      return await this.fetchMessagesPMail();
    } else if (this.sourceId === 'tinyhost') {
      return await this.fetchMessagesTinyHost();
    } else if (this.sourceId === 'edumail') {
      return await this.fetchMessagesEduMail();
    } else if (this.sourceId === 'apple') {
      return await this.fetchMessagesApple();
    } else if (this.sourceId === 'generatoremail') {
      return await this.fetchMessagesGeneratorEmail();
    } else if (this.sourceId === 'moakt') {
      return await this.fetchMessagesMoakt();
    } else if (this.sourceId === 'tempmailapi') {
      return await this.fetchMessagesTempMailApi();
    } else if (this.sourceId === 'inboxes') {
      return await this.fetchMessagesInboxes();
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
          // Lỗi sync email (có thể không ảnh hưởng)
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
    // Polling đã bị vô hiệu hóa
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

    // NoopMail, TemporaryMail, MailIO, Apple, GeneratorEmail và Moakt: Gọi API để lấy chi tiết message
    if ((this.sourceId === 'noopmail' || this.sourceId === 'temporarymail' || this.sourceId === 'mailio' || this.sourceId === 'apple' || this.sourceId === 'generatoremail' || this.sourceId === 'moakt' || this.sourceId === 'tempmailapi' || this.sourceId === 'inboxes') && this.client && typeof this.client.getMessageDetail === 'function') {
      return await this.client.getMessageDetail(messageId);
    }

    // Apple: Dùng readMessage thay vì getMessageDetail
    if (this.sourceId === 'apple' && this.client && typeof this.client.readMessage === 'function') {
      const result = await this.client.readMessage(messageId);
      if (result.success && result.message) {
        return {
          success: true,
          content: result.message.body_html || result.message.body_text || '',
          content_raw: result.message.body_text || result.message.body_html || '',
          html: result.message.body_html || null,
          text: result.message.body_text || null,
          subject: result.message.subject || '',
          from: result.message.sender_email || '',
          to: this.currentEmail || '',
          date: result.message.date || null
        };
      }
      return result;
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
   * Fetch messages cho TemporaryMail
   */
  async fetchMessagesTemporaryMail() {
    try {
      // Đảm bảo client có currentEmail và secretKey được set
      if (this.currentEmail && this.client) {
        // Lấy secretKey từ client (đã được set từ server khi sync)
        const secretKey = this.client.secretKey || (this.client.getSecretKey ? this.client.getSecretKey() : null);

        // Set email và secretKey vào client
        this.client.setCurrentEmail(this.currentEmail, secretKey);

        // Đảm bảo secretKey được set (nếu có)
        if (secretKey && !this.client.secretKey) {
          this.client.secretKey = secretKey;
        }
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
   * Fetch messages cho MailIO
   */
  async fetchMessagesMailIO() {
    try {
      // Đảm bảo client có currentEmail được set
      if (this.currentEmail && this.client) {
        this.client.setCurrentEmail(this.currentEmail);
      }

      const result = await this.client.fetchMessages();

      if (result.success) {
        // Format messages để đồng nhất với format chung
        const formattedMessages = result.messages.map((msg, index) => {
          // Tính datediff từ created_at (mail.io trả về created_at dạng ISO 8601)
          let datediff = null;
          let date = null;
          let timestamp = msg.date || null;

          // MailIO trả về created_at trong response từ client
          const createdAt = msg.created_at || msg.date;
          if (createdAt) {
            try {
              const msgDate = new Date(createdAt);
              if (!isNaN(msgDate.getTime())) {
                timestamp = msgDate.getTime();

                // Format date
                date = msgDate.toLocaleString('vi-VN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });

                // Tính datediff từ created_at
                const now = new Date();
                const diffMs = now - msgDate;
                const diffSecs = Math.floor(diffMs / 1000);
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);

                if (diffSecs < 60) {
                  datediff = diffSecs < 1 ? 'Vừa xong' : `${diffSecs} giây trước`;
                } else if (diffMins < 60) {
                  datediff = `${diffMins} phút trước`;
                } else if (diffHours < 24) {
                  datediff = `${diffHours} giờ trước`;
                } else {
                  datediff = `${diffDays} ngày trước`;
                }
              }
            } catch (e) {
              // Ignore date parsing errors
            }
          }

          return {
            id: msg.id || `msg-${index}`,
            subject: msg.subject || 'Không có tiêu đề',
            sender_name: msg.from ? msg.from.split('<')[0].trim().replace(/"/g, '') : 'Không rõ',
            sender_email: msg.from ? (msg.from.match(/<(.+)>/) ? msg.from.match(/<(.+)>/)[1] : msg.from) : '',
            date: date,
            datediff: datediff,
            timestamp: timestamp,
            content: this.formatEmailContent(msg.body || msg.text || ''),
            content_raw: msg.body || msg.text || '',
            html: msg.html || '',
            attachments: msg.attachments || []
          };
        });

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
   * Fetch messages cho eTempMail
   */
  async fetchMessagesETempMail() {
    try {
      // Đảm bảo client có currentEmail được set
      if (this.currentEmail && this.client) {
        this.client.currentEmail = this.currentEmail;
      }

      // eTempMail dùng getInbox() thay vì fetchMessages()
      const result = await this.client.getInbox();

      if (result.success) {
        // Format messages để đồng nhất với format chung
        const formattedMessages = result.messages.map((msg, index) => {
          // Parse date từ format "05/12/2025 16:40:23"
          let datediff = null;
          let date = msg.date || null;
          let timestamp = null;

          if (date) {
            try {
              // Parse date format: "05/12/2025 16:40:23" (DD/MM/YYYY HH:mm:ss)
              const dateParts = date.split(' ');
              const dateOnly = dateParts[0]; // "05/12/2025"
              const timeOnly = dateParts[1] || '00:00:00'; // "16:40:23"

              const [day, month, year] = dateOnly.split('/');
              const [hour, minute, second] = timeOnly.split(':');

              const msgDate = new Date(
                parseInt(year),
                parseInt(month) - 1, // Month is 0-indexed
                parseInt(day),
                parseInt(hour || 0),
                parseInt(minute || 0),
                parseInt(second || 0)
              );

              if (!isNaN(msgDate.getTime())) {
                timestamp = msgDate.getTime();

                // Format date
                date = msgDate.toLocaleString('vi-VN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });

                // Tính datediff
                const now = new Date();
                const diffMs = now - msgDate;
                const diffSecs = Math.floor(diffMs / 1000);
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);

                if (diffSecs < 60) {
                  datediff = diffSecs < 1 ? 'Vừa xong' : `${diffSecs} giây trước`;
                } else if (diffMins < 60) {
                  datediff = `${diffMins} phút trước`;
                } else if (diffHours < 24) {
                  datediff = `${diffHours} giờ trước`;
                } else {
                  datediff = `${diffDays} ngày trước`;
                }
              }
            } catch (e) {
              // Ignore date parsing errors
            }
          }

          // Parse from field để lấy sender_name và sender_email
          let sender_name = 'Không rõ';
          let sender_email = '';

          if (msg.from) {
            // Format: "Neon <no-reply@neon.tech>" hoặc "no-reply@neon.tech"
            const fromMatch = msg.from.match(/^(.+?)\s*<(.+)>$/);
            if (fromMatch) {
              sender_name = fromMatch[1].trim().replace(/"/g, '');
              sender_email = fromMatch[2].trim();
            } else {
              // Chỉ có email
              sender_email = msg.from.trim();
              sender_name = sender_email.split('@')[0];
            }
          }

          return {
            id: msg.id || `msg-${index}`,
            subject: msg.subject || 'Không có tiêu đề',
            sender_name: sender_name,
            sender_email: sender_email,
            date: date,
            datediff: datediff,
            timestamp: timestamp,
            content: this.formatEmailContent(msg.html || msg.body || ''),
            content_raw: msg.html || msg.body || '',
            text: msg.text || '',
            html: msg.html || msg.body || '',
            attachments: []
          };
        });

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
   * Fetch messages cho Priyo
   */
  async fetchMessagesPriyo() {
    try {
      console.log('[TempMail] fetchMessagesPriyo - Starting...');
      console.log('[TempMail] Current email:', this.currentEmail);
      console.log('[TempMail] Client exists:', !!this.client);

      // Sync email trước khi fetch messages (bỏ qua nếu lỗi)
      if (this.currentEmail && this.client) {
        console.log('[TempMail] Syncing email before fetchMessages...');
        try {
          const syncResult = await this.client.syncEmail(this.currentEmail);
          console.log('[TempMail] Sync result:', syncResult.success, syncResult.error || 'OK');
        } catch (syncError) {
          console.log('[TempMail] Sync failed, continuing with fetchMessages:', syncError.message);
          // Bỏ qua lỗi sync, tiếp tục fetchMessages
        }
      }

      console.log('[TempMail] Calling client.fetchMessages()...');
      const result = await this.client.fetchMessages();
      console.log('[TempMail] FetchMessages result:', {
        success: result.success,
        count: result.count,
        error: result.error || null
      });

      if (result.success) {
        // Format messages để đồng nhất với format chung
        const formattedMessages = result.messages.map((msg, index) => {
          // Parse date
          let datediff = null;
          let date = msg.date || null;
          let timestamp = msg.timestamp || null;

          if (date && !timestamp) {
            try {
              const msgDate = new Date(date);
              if (!isNaN(msgDate.getTime())) {
                timestamp = msgDate.getTime();

                // Format date
                date = msgDate.toLocaleString('vi-VN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });

                // Tính datediff
                const now = new Date();
                const diffMs = now - msgDate;
                const diffSecs = Math.floor(diffMs / 1000);
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);

                if (diffSecs < 60) {
                  datediff = diffSecs < 1 ? 'Vừa xong' : `${diffSecs} giây trước`;
                } else if (diffMins < 60) {
                  datediff = `${diffMins} phút trước`;
                } else if (diffHours < 24) {
                  datediff = `${diffHours} giờ trước`;
                } else {
                  datediff = `${diffDays} ngày trước`;
                }
              }
            } catch (e) {
              // Ignore date parsing errors
            }
          }

          return {
            id: msg.id || `msg-${index}`,
            subject: msg.subject || 'Không có tiêu đề',
            sender_name: msg.sender_name || 'Không rõ',
            sender_email: msg.sender_email || '',
            date: date,
            datediff: datediff,
            timestamp: timestamp,
            content: this.formatEmailContent(msg.content || msg.content_raw || ''),
            content_raw: msg.content_raw || msg.content || '',
            attachments: msg.attachments || []
          };
        });

        return {
          success: true,
          messages: formattedMessages,
          count: formattedMessages.length
        };
      }

      return result;
    } catch (error) {
      console.error('[TempMail] fetchMessagesPriyo error:', error.message);
      console.error('[TempMail] Error stack:', error.stack);
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Fetch messages cho PMAIL
   */
  async fetchMessagesPMail() {
    try {
      if (!this.currentEmail) {
        return {
          success: true,
          messages: [],
          count: 0
        };
      }

      const result = await this.client.fetchMessages();

      if (result.success) {
        // Format messages để đồng nhất với format chung
        const formattedMessages = result.messages.map((msg, index) => {
          // Parse date
          let datediff = null;
          let date = msg.date || null;
          let timestamp = msg.timestamp || null;

          if (date && !timestamp) {
            try {
              const msgDate = new Date(date);
              if (!isNaN(msgDate.getTime())) {
                timestamp = msgDate.getTime();

                // Format date
                date = msgDate.toLocaleString('vi-VN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });

                // Tính datediff
                const now = new Date();
                const diffMs = now - msgDate;
                const diffSecs = Math.floor(diffMs / 1000);
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);

                if (diffSecs < 60) {
                  datediff = diffSecs < 1 ? 'Vừa xong' : `${diffSecs} giây trước`;
                } else if (diffMins < 60) {
                  datediff = `${diffMins} phút trước`;
                } else if (diffHours < 24) {
                  datediff = `${diffHours} giờ trước`;
                } else {
                  datediff = `${diffDays} ngày trước`;
                }
              }
            } catch (e) {
              // Ignore date parsing errors
            }
          }

          return {
            id: msg.id || `msg-${index}`,
            subject: msg.subject || 'Không có tiêu đề',
            sender_name: msg.sender_name || 'Không rõ',
            sender_email: msg.sender_email || '',
            date: date,
            datediff: datediff || msg.datediff,
            timestamp: timestamp,
            content: this.formatEmailContent(msg.content || msg.content_raw || ''),
            content_raw: msg.content_raw || msg.content || '',
            attachments: msg.attachments || []
          };
        });

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
   * Fetch messages cho TinyHost
   */
  async fetchMessagesTinyHost() {
    try {
      if (!this.currentEmail) {
        return {
          success: true,
          messages: [],
          count: 0
        };
      }

      const result = await this.client.fetchMessages();

      // TinyHost client.fetchMessages() trả về array trực tiếp, không có wrapper
      const messages = Array.isArray(result) ? result : [];

      // Format messages để đồng nhất với format chung
      const formattedMessages = messages.map((msg, index) => {
        // Parse date
        let datediff = msg.datediff;
        let date = msg.date || null;
        let timestamp = msg.timestamp || null;

        // Nếu chưa có datediff, tính lại
        if (!datediff && date) {
          try {
            const msgDate = new Date(date);
            if (!isNaN(msgDate.getTime())) {
              // TinyHost trả về UTC time, cộng 7 giờ để convert sang VN
              const msgDateVN = new Date(msgDate.getTime() + (7 * 60 * 60 * 1000));

              if (!timestamp) {
                timestamp = msgDate.getTime();
              }

              // Format date theo giờ VN
              date = msgDateVN.toLocaleString('vi-VN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });

              // Tính datediff
              const now = new Date();
              const diffMs = now - msgDateVN;
              const diffMins = Math.floor(diffMs / 60000);
              const diffHours = Math.floor(diffMins / 60);
              const diffDays = Math.floor(diffHours / 24);

              if (diffDays > 0) {
                datediff = `${diffDays} ngày trước`;
              } else if (diffHours > 0) {
                datediff = `${diffHours} giờ trước`;
              } else if (diffMins > 0) {
                datediff = `${diffMins} phút trước`;
              } else {
                datediff = 'Vừa xong';
              }
            }
          } catch (e) {
            // Ignore date parse error
          }
        }

        return {
          id: msg.id || `msg-${index}`,
          subject: msg.subject || 'Không có tiêu đề',
          sender_name: msg.sender_name || 'Không rõ',
          sender_email: msg.sender_email || '',
          date: date,
          datediff: datediff || msg.datediff || 'Không rõ',
          timestamp: timestamp,
          content: this.formatEmailContent(msg.content || msg.content_raw || ''),
          content_raw: msg.content_raw || msg.content || '',
          attachments: msg.attachments || []
        };
      });

      return {
        success: true,
        messages: formattedMessages,
        count: formattedMessages.length
      };
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
   * Fetch messages cho EduMail
   */
  async fetchMessagesEduMail() {
    try {
      if (!this.currentEmail) {
        return {
          success: true,
          messages: [],
          count: 0
        };
      }

      const result = await this.client.fetchMessages();

      if (result.success) {
        // Parse messages giống TMail (có thể có nested arrays)
        let rawMessages = result.messages || [];

        // Flatten nested arrays - EduMail format: [[msg1], [msg2], ...]
        let flatMessages = [];
        for (const item of rawMessages) {
          if (Array.isArray(item)) {
            // Nested array - flatten recursively
            for (const subItem of item) {
              if (Array.isArray(subItem)) {
                // Double nested - flatten again
                flatMessages = flatMessages.concat(subItem);
              } else if (subItem && typeof subItem === 'object') {
                // Message object
                flatMessages.push(subItem);
              }
            }
          } else if (item && typeof item === 'object') {
            if (item.id || item.subject || item.sender_name) {
              // Direct message object
              flatMessages.push(item);
            }
          }
        }

        console.log('[TempMail] EduMail messages count after flatten:', flatMessages.length);

        // Format messages để đồng nhất với format chung
        const formattedMessages = flatMessages
          .filter(msg => msg && typeof msg === 'object')
          .map((msg, index) => {
            // Parse date
            let datediff = msg.datediff;
            let date = msg.date || null;
            let timestamp = msg.timestamp || null;

            // Handle timestamp array format
            if (Array.isArray(timestamp)) {
              timestamp = timestamp[0];
            }

            // Nếu chưa có datediff, tính lại
            if (!datediff && date) {
              try {
                const msgDate = new Date(date);
                if (!isNaN(msgDate.getTime())) {
                  if (!timestamp) {
                    timestamp = msgDate.getTime();
                  }

                  // Format date
                  date = msgDate.toLocaleString('vi-VN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  // Tính datediff
                  const now = new Date();
                  const diffMs = now - msgDate;
                  const diffSecs = Math.floor(diffMs / 1000);
                  const diffMins = Math.floor(diffMs / 60000);
                  const diffHours = Math.floor(diffMs / 3600000);
                  const diffDays = Math.floor(diffMs / 86400000);

                  if (diffSecs < 60) {
                    datediff = diffSecs < 1 ? 'Vừa xong' : `${diffSecs} giây trước`;
                  } else if (diffMins < 60) {
                    datediff = `${diffMins} phút trước`;
                  } else if (diffHours < 24) {
                    datediff = `${diffHours} giờ trước`;
                  } else {
                    datediff = `${diffDays} ngày trước`;
                  }
                }
              } catch (e) {
                // Ignore date parsing errors
              }
            }

            // Handle attachments array format
            let attachments = msg.attachments || [];
            if (Array.isArray(attachments) && attachments.length === 2 && attachments[1]?.s === 'arr') {
              attachments = attachments[0] || [];
            }

            return {
              id: msg.id || `msg-${index}`,
              subject: msg.subject || 'Không có tiêu đề',
              sender_name: msg.sender_name || 'Không rõ',
              sender_email: msg.sender_email || '',
              date: date,
              datediff: datediff || msg.datediff,
              timestamp: timestamp,
              content: this.formatEmailContent(msg.content || msg.content_raw || ''),
              content_raw: msg.content || msg.content_raw || '',
              attachments: attachments,
              // Thêm flag để frontend có thể filter
              hasContent: !!(msg.content || msg.content_raw)
            };
          });

        // Optional: Filter chỉ lấy messages có content
        // const messagesWithContent = formattedMessages.filter(msg => msg.hasContent);

        return {
          success: true,
          messages: formattedMessages, // Hoặc messagesWithContent nếu muốn filter
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
   * Fetch messages cho Apple
   */
  async fetchMessagesApple() {
    try {
      if (!this.currentEmail) {
        return {
          success: true,
          messages: [],
          count: 0
        };
      }

      const result = await this.client.fetchMessages();

      if (result.success) {
        // Apple client đã format messages sẵn, chỉ cần thêm format content
        const formattedMessages = result.messages.map(msg => ({
          ...msg,
          content: this.formatEmailContent(msg.body || ''),
          content_raw: msg.body || ''
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
   * Fetch messages cho GeneratorEmail
   */
  async fetchMessagesGeneratorEmail() {
    try {
      if (!this.currentEmail) {
        return { success: true, messages: [], count: 0 };
      }

      const result = await this.client.fetchMessages();
      return result;
    } catch (error) {
      console.error('[TempMail] Error fetching GeneratorEmail messages:', error.message);
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Tạo email cho nguồn Moakt (moakt.com)
   */
  async createEmailMoakt(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

      if (result.success) {
        this.currentEmail = result.email;

        if (this.client && typeof this.client.setCurrentEmail === 'function') {
          this.client.setCurrentEmail(this.currentEmail);
        }

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch messages cho Moakt
   */
  async fetchMessagesMoakt() {
    try {
      if (!this.currentEmail) {
        return { success: true, messages: [], count: 0 };
      }

      const result = await this.client.fetchMessages();
      return result;
    } catch (error) {
      console.error('[TempMail] Error fetching Moakt messages:', error.message);
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Tạo email cho TempMailAPI
   */
  async createEmailTempMailApi(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

      if (result.success) {
        this.currentEmail = result.email;

        if (this.client && typeof this.client.setCurrentEmail === 'function') {
          this.client.setCurrentEmail(this.currentEmail);
        }

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch messages cho TempMailAPI
   */
  async fetchMessagesTempMailApi() {
    try {
      if (!this.currentEmail) {
        return { success: true, messages: [], count: 0 };
      }

      const result = await this.client.fetchMessages();
      return result;
    } catch (error) {
      console.error('[TempMail] Error fetching TempMailAPI messages:', error.message);
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }

  /**
   * Tạo email cho Inboxes.com
   */
  async createEmailInboxes(username, selectedDomain) {
    try {
      const result = await this.client.createEmail(username, selectedDomain);

      if (result.success) {
        this.currentEmail = result.email;

        if (this.client && typeof this.client.setCurrentEmail === 'function') {
          this.client.setCurrentEmail(this.currentEmail);
        }

        if (!this.emails.includes(this.currentEmail)) {
          this.emails.push(this.currentEmail);
        }

        return {
          success: true,
          email: this.currentEmail,
          message: `Email tạm đã được tạo: ${this.currentEmail}`
        };
      }

      return {
        success: false,
        error: result.error || 'Không thể tạo email'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch messages cho Inboxes.com
   */
  async fetchMessagesInboxes() {
    try {
      if (!this.currentEmail) {
        return { success: true, messages: [], count: 0 };
      }

      const result = await this.client.fetchMessages();
      return result;
    } catch (error) {
      console.error('[TempMail] Error fetching Inboxes messages:', error.message);
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

              // Flatten nested arrays nếu có
              let flatMessages = [];
              for (const item of messagesArray) {
                if (Array.isArray(item)) {
                  // Nested array - flatten
                  flatMessages = flatMessages.concat(item);
                } else if (item && typeof item === 'object') {
                  if (item.id) {
                    // Direct message object
                    flatMessages.push(item);
                  } else {
                    // Object nhưng không phải message (có thể là metadata)
                  }
                }
              }

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

                  return parsed;
                });
            }
          } catch (e) {
            // Lỗi parse messages
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
      body.find('*').each(function () {
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
      // Lỗi format email content
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

    // MailIO: Gọi API delete thật
    if (this.sourceId === 'mailio') {
      try {
        const result = await this.client.deleteEmail();

        if (result.success) {
          // Xóa email khỏi danh sách
          this.emails = this.emails.filter(e => e !== this.currentEmail);
          this.currentEmail = null;
        }

        return result;
      } catch (error) {
        // Lỗi xóa email
        return {
          success: false,
          error: error.message
        };
      }
    }

    // TemporaryMail, NoopMail: Không có API delete, tự động tạo email random mới
    if (this.sourceId === 'temporarymail' || this.sourceId === 'noopmail') {
      try {
        // Lưu email cũ để xóa khỏi danh sách
        const deletedEmail = this.currentEmail;

        // Tự động tạo email random mới
        const result = await this.createRandomEmail();

        if (result.success) {
          // Xóa email cũ khỏi danh sách
          this.emails = this.emails.filter(e => e !== deletedEmail);

          // Email mới đã được set trong createRandomEmail()
          return {
            success: true,
            message: 'Email đã được xóa và tạo email mới',
            newEmail: this.currentEmail,
            email: this.currentEmail,
            secretKey: result.secretKey || null,
            token: result.token || null
          };
        }

        return {
          success: false,
          error: result.error || 'Không thể tạo email mới'
        };
      } catch (error) {
        // Lỗi xóa email
        return {
          success: false,
          error: error.message
        };
      }
    }

    // Priyo: Gọi API delete từ client
    if (this.sourceId === 'priyo') {
      try {
        const result = await this.client.deleteEmail();

        if (result.success) {
          // Xóa email khỏi danh sách
          this.emails = this.emails.filter(e => e !== this.currentEmail);

          // Update currentEmail từ result (có thể là email mới hoặc null)
          if (result.email) {
            this.currentEmail = result.email;
            if (!this.emails.includes(this.currentEmail)) {
              this.emails.push(this.currentEmail);
            }
          } else {
            this.currentEmail = null;
          }

          return {
            success: true,
            message: result.message || 'Email đã được xóa',
            newEmail: this.currentEmail || null
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

    // Tất cả nguồn khác không có API delete: tự tạo email random mới
    if (this.sourceId !== 'tmail') {
      try {
        const deletedEmail = this.currentEmail;
        const result = await this.createRandomEmail();
        if (result.success) {
          this.emails = this.emails.filter(e => e !== deletedEmail);
          return {
            success: true,
            message: 'Email đã được xóa và tạo email mới',
            newEmail: this.currentEmail,
            email: this.currentEmail,
            secretKey: result.secretKey || null,
            token: result.token || null,
            password: result.password || null
          };
        }
        return { success: false, error: result.error || 'Không thể tạo email mới' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    // TMail: Dùng logic getSnapshot và sendRequest
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
          // DeleteEmail có redirect

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
              // Lấy email mới từ actions snapshot
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
        // Email đã xóa, tự động chuyển sang email mới

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
      // Lỗi parse email từ HTML
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
