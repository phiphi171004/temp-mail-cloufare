import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * iMail Livewire Client
 * Client kết nối với imail.edu.vn (cấu trúc Livewire khác với tmail.mmocommunity.io.vn)
 */
export class IMailClient {
  constructor() {
    this.baseURL = 'https://imail.edu.vn';
    this.apiEndpoint = '/livewire/message';
    this.csrfToken = null;
    this.cookies = {};
    this.componentFingerprints = {
      actions: null,
      app: null
    };
    this.componentServerMemos = {
      actions: null,
      app: null
    };
    // Polling state
    this.pollingInterval = null;
    this.pollingCallback = null;
    this.isPolling = false;
  }

  /**
   * Khởi tạo session - lấy CSRF token và cookies
   */
  async initialize() {
    try {
      console.log('\n=== INITIALIZING iMail SESSION ===');
      
      const response = await axios.get(this.baseURL, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      // Parse CSRF token từ HTML
      const html = response.data;
      
      // Ưu tiên lấy từ meta tag
      const $ = cheerio.load(html);
      let csrfToken = $('meta[name="csrf-token"]').attr('content');
      
      // Nếu không có trong meta, thử lấy từ input hidden
      if (!csrfToken) {
        csrfToken = $('input[name="_token"]').attr('value');
      }
      
      // Nếu vẫn không có, thử lấy từ window.livewire_token trong script
      if (!csrfToken) {
        const scriptMatch = html.match(/window\.livewire_token\s*=\s*['"]([^'"]+)['"]/);
        if (scriptMatch) {
          csrfToken = scriptMatch[1];
        }
      }
      
      // Nếu vẫn không có, thử lấy từ cookie XSRF-TOKEN (nhưng cần decode)
      if (!csrfToken && this.cookies['XSRF-TOKEN']) {
        // Cookie XSRF-TOKEN là encrypted, không dùng trực tiếp
        // Cần lấy từ meta/input thay vì cookie
      }
      
      if (csrfToken) {
        this.csrfToken = csrfToken;
        console.log('✓ CSRF Token:', this.csrfToken);
      } else {
        console.log('✗ CSRF Token not found!');
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
        console.log(`✓ Received ${Object.keys(this.cookies).length} cookies`);
      }

      // Parse initial component fingerprints và server memos từ HTML
      this.parseComponentData(html);
      
      // QUAN TRỌNG: Nếu chưa có app component, cần fetch /mailbox để lấy
      // Vì app component thường nằm trong /mailbox page, không phải homepage
      if (!this.componentFingerprints.app || !this.componentServerMemos.app) {
        console.log('⚠️  App component chưa có, đang fetch từ /mailbox...');
        try {
          await this.fetchAndUpdateComponentData(`${this.baseURL}/mailbox`);
          if (this.componentFingerprints.app && this.componentServerMemos.app) {
            console.log('✓ Đã lấy app component từ /mailbox');
          } else {
            console.warn('⚠️  Vẫn chưa tìm thấy app component sau khi fetch /mailbox');
          }
        } catch (error) {
          console.warn('⚠️  Lỗi khi fetch /mailbox:', error.message);
          // Không throw error, vì có thể app component sẽ được init sau
        }
      }
      
      console.log('============================\n');

      return true;
    } catch (error) {
      console.error('Lỗi khởi tạo iMail session:', error.message);
      return false;
    }
  }

  /**
   * Parse component fingerprints và server memos từ HTML
   */
  parseComponentData(html) {
    try {
      const $ = cheerio.load(html);
      
      // Tìm tất cả elements có wire:id (Livewire component)
      // iMail dùng wire:initial-data thay vì wire:snapshot
      $('[wire\\:id]').each((i, el) => {
        const wireId = $(el).attr('wire:id');
        // Thử wire:initial-data trước (iMail)
        let wireData = $(el).attr('wire:initial-data');
        // Nếu không có, thử wire:snapshot (TMail)
        if (!wireData) {
          wireData = $(el).attr('wire:snapshot');
        }
        
        // QUAN TRỌNG: Nếu không có wire:initial-data hoặc wire:snapshot
        // Có thể component được render bằng JavaScript, thử tìm trong script tags
        if (!wireId || !wireData) {
          // Thử tìm trong script tags (Livewire có thể inject component data vào script)
          const scriptTags = $('script');
          scriptTags.each((j, scriptEl) => {
            const scriptContent = $(scriptEl).html();
            if (scriptContent && scriptContent.includes('wire:id') && scriptContent.includes(wireId)) {
              // Tìm component data trong script
              const dataMatch = scriptContent.match(new RegExp(`wire:id="${wireId}"[^>]*wire:initial-data="([^"]+)"`));
              if (dataMatch) {
                wireData = dataMatch[1];
              }
            }
          });
        }
        
        if (!wireId || !wireData) return;
        
        try {
          // Decode HTML entities
          const decoded = wireData
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          
          const parsed = JSON.parse(decoded);
          
          // Xác định component type dựa vào name trong fingerprint
          if (parsed.fingerprint && parsed.fingerprint.name === 'frontend.actions') {
            this.componentFingerprints.actions = parsed.fingerprint;
            this.componentServerMemos.actions = parsed.serverMemo;
            console.log('✓ Parsed actions component - ID:', parsed.fingerprint.id);
          } else if (parsed.fingerprint && parsed.fingerprint.name === 'frontend.app') {
            this.componentFingerprints.app = parsed.fingerprint;
            this.componentServerMemos.app = parsed.serverMemo;
            console.log('✓ Parsed app component - ID:', parsed.fingerprint.id);
          }
        } catch (e) {
          console.error('✗ Lỗi parse wire data:', e.message);
        }
      });
      
      // Nếu không tìm thấy trong HTML, thử parse từ script tags
      if (!this.componentFingerprints.actions || !this.componentFingerprints.app) {
        $('script').each((i, el) => {
          const scriptContent = $(el).html();
          if (scriptContent && scriptContent.includes('Livewire')) {
            // Tìm Livewire component data trong script
            const match = scriptContent.match(/Livewire\.all\(\)\s*=\s*({[\s\S]*?});/);
            if (match) {
              try {
                const data = JSON.parse(match[1]);
                // Parse components từ data
                Object.values(data).forEach(component => {
                  if (component && component.fingerprint) {
                    if (component.fingerprint.name === 'frontend.actions' && !this.componentFingerprints.actions) {
                      this.componentFingerprints.actions = component.fingerprint;
                      this.componentServerMemos.actions = component.serverMemo;
                      console.log('✓ Parsed actions component từ script - ID:', component.fingerprint.id);
                    } else if (component.fingerprint.name === 'frontend.app' && !this.componentFingerprints.app) {
                      this.componentFingerprints.app = component.fingerprint;
                      this.componentServerMemos.app = component.serverMemo;
                      console.log('✓ Parsed app component từ script - ID:', component.fingerprint.id);
                    }
                  }
                });
              } catch (e) {
                // Ignore
              }
            }
          }
        });
      }
      
      // Nếu vẫn chưa tìm thấy app component, thử tìm trong main tag hoặc các tag khác
      if (!this.componentFingerprints.app) {
        // Tìm trong main tag (app component thường nằm trong main)
        $('main[wire\\:id]').each((i, el) => {
          const wireId = $(el).attr('wire:id');
          // Thử tìm trong script tags với wireId này
          $('script').each((j, scriptEl) => {
            const scriptContent = $(scriptEl).html();
            if (scriptContent && scriptContent.includes(wireId)) {
              // Tìm component data trong script với pattern khác
              const patterns = [
                new RegExp(`"id":"${wireId}"[^}]*"name":"frontend\\.app"[^}]*}([^}]*})`, 'g'),
                new RegExp(`"name":"frontend\\.app"[^}]*"id":"${wireId}"[^}]*}([^}]*})`, 'g'),
                new RegExp(`frontend\\.app.*${wireId}.*serverMemo`, 'g')
              ];
              
              for (const pattern of patterns) {
                const match = scriptContent.match(pattern);
                if (match) {
                  try {
                    // Thử parse JSON từ match
                    const jsonMatch = scriptContent.match(new RegExp(`{[^}]*"id":"${wireId}"[^}]*"name":"frontend\\.app"[^}]*}[^}]*}`, 'g'));
                    if (jsonMatch) {
                      const parsed = JSON.parse(jsonMatch[0]);
                      if (parsed.fingerprint && parsed.serverMemo) {
                        this.componentFingerprints.app = parsed.fingerprint;
                        this.componentServerMemos.app = parsed.serverMemo;
                        console.log('✓ Parsed app component từ main tag - ID:', parsed.fingerprint.id);
                        return false; // Break loop
                      }
                    }
                  } catch (e) {
                    // Ignore
                  }
                }
              }
            }
          });
        });
      }
    } catch (e) {
      console.error('✗ Lỗi parse component data:', e.message);
    }
  }

  /**
   * Fetch HTML từ URL và update component data (dùng khi có redirect)
   */
  async fetchAndUpdateComponentData(url) {
    try {
      const fullUrl = url.startsWith('http') ? url : `${this.baseURL}${url.startsWith('/') ? url : '/' + url}`;
      
      const response = await axios.get(fullUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'cookie': this.getCookieString()
        }
      });

      // Update cookies
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

      // Parse CSRF token mới
      const html = response.data;
      const csrfMatch = html.match(/name="csrf-token" content="([^"]+)"/);
      if (csrfMatch) {
        this.csrfToken = csrfMatch[1];
      }

      // Parse component data từ HTML
      this.parseComponentData(html);
      
      return true;
    } catch (error) {
      console.error('Lỗi fetch HTML từ redirect:', error.message);
      return false;
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
  async sendRequest(componentName, updates = []) {
    if (!this.csrfToken) {
      await this.initialize();
    }

    const fingerprint = this.componentFingerprints[componentName];
    const serverMemo = this.componentServerMemos[componentName];

    if (!fingerprint || !serverMemo) {
      throw new Error(`Component ${componentName} chưa được khởi tạo`);
    }

    const payload = {
      fingerprint: fingerprint,
      serverMemo: serverMemo,
      updates: updates
    };

    // Debug: Log payload (chỉ log một phần để không spam)
    if (updates.length > 0 && updates[0].type === 'callMethod' && updates[0].payload.method === 'create') {
      console.log('📤 Sending create request with checksum:', serverMemo.checksum);
      console.log('  - ServerMemo has children:', !!serverMemo.children);
      console.log('  - ServerMemo has errors:', !!serverMemo.errors);
      console.log('  - ServerMemo has htmlHash:', !!serverMemo.htmlHash);
      console.log('  - ServerMemo has dataMeta:', !!serverMemo.dataMeta);
      console.log('  - ServerMemo data keys:', Object.keys(serverMemo.data || {}));
    }

    const requestHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'text/html, application/xhtml+xml',
      'X-Livewire': 'true',
      'X-CSRF-TOKEN': this.csrfToken,
      'Cookie': this.getCookieString(),
      'Origin': this.baseURL,
      'Referer': `${this.baseURL}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    };

    try {
      const response = await axios.post(
        `${this.baseURL}${this.apiEndpoint}/${componentName}`,
        payload,
        {
          headers: requestHeaders,
          withCredentials: true
        }
      );

      // Update cookies
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

      // Update CSRF token từ response headers nếu có
      if (response.headers['x-csrf-token']) {
        this.csrfToken = response.headers['x-csrf-token'];
      }

      // Update server memo từ response
      // QUAN TRỌNG: Response chỉ trả về một phần serverMemo (data + checksum)
      // Cần merge với serverMemo hiện tại để giữ lại các field khác (children, errors, htmlHash, dataMeta)
      // VÀ QUAN TRỌNG: Merge data từng field một (giống Livewire client iindex.js dòng 113-151)
      // Điều này đảm bảo nếu response không có field nào, field đó sẽ giữ nguyên giá trị cũ
      if (response.data && response.data.serverMemo) {
        const currentMemo = this.componentServerMemos[componentName];
        if (currentMemo) {
          // Merge data từng field một (giống Livewire client)
          // Livewire chỉ trả về data đã thay đổi, nên chỉ merge những field có trong response
          if (response.data.serverMemo.data) {
            Object.entries(response.data.serverMemo.data).forEach(([dataKey, dataValue]) => {
              // QUAN TRỌNG: Với messages, luôn ghi đè hoàn toàn với giá trị mới từ server
              // Vì server trả về danh sách messages đầy đủ, không phải chỉ những message mới
              if (dataKey === 'messages' && Array.isArray(dataValue)) {
                // Ghi đè hoàn toàn messages array với giá trị mới từ server
                currentMemo.data[dataKey] = dataValue;
                console.log(`✓ Updated messages array: ${dataValue.length} message(s) from server`);
              } else {
                // Với các field khác, ghi đè như bình thường
                currentMemo.data[dataKey] = dataValue;
              }
            });
          }
          
          // Merge các field khác của serverMemo (checksum, htmlHash, etc.)
          if (response.data.serverMemo.checksum) {
            currentMemo.checksum = response.data.serverMemo.checksum;
          }
          if (response.data.serverMemo.htmlHash !== undefined) {
            currentMemo.htmlHash = response.data.serverMemo.htmlHash;
          }
          if (response.data.serverMemo.children !== undefined) {
            currentMemo.children = response.data.serverMemo.children;
          }
          if (response.data.serverMemo.errors !== undefined) {
            currentMemo.errors = response.data.serverMemo.errors;
          }
          if (response.data.serverMemo.dataMeta !== undefined) {
            currentMemo.dataMeta = response.data.serverMemo.dataMeta;
          }
          
          // QUAN TRỌNG: Merge lại vào response để response có đầy đủ serverMemo (giống Livewire client)
          // Điều này đảm bảo khi fetchMessages, response.serverMemo.data.messages sẽ có đầy đủ
          response.data.serverMemo = Object.assign({}, currentMemo);
        } else {
          // Nếu chưa có, dùng serverMemo mới (nhưng cần đảm bảo có đầy đủ field)
          const newMemo = {
            children: response.data.serverMemo.children || [],
            errors: response.data.serverMemo.errors || [],
            htmlHash: response.data.serverMemo.htmlHash || '',
            data: response.data.serverMemo.data || {},
            dataMeta: response.data.serverMemo.dataMeta || [],
            checksum: response.data.serverMemo.checksum || ''
          };
          this.componentServerMemos[componentName] = newMemo;
          // Merge lại vào response
          response.data.serverMemo = Object.assign({}, newMemo);
        }
      }

      // QUAN TRỌNG: Nếu đang gọi app component lần đầu và response có HTML
      // Cần parse và update app component từ response
      if (componentName === 'app' && response.data && response.data.effects && response.data.effects.html) {
        // Parse HTML để lấy wire:id thực sự
        const $ = cheerio.load(response.data.effects.html);
        const wireId = $('[wire\\:id]').first().attr('wire:id');
        if (wireId && wireId !== this.componentFingerprints.app.id) {
          // Update fingerprint ID từ response
          this.componentFingerprints.app.id = wireId;
          console.log('✓ Updated app component ID từ response:', wireId);
        }
      }
      
      // QUAN TRỌNG: Nếu đang gọi actions component và response có children hoặc effects chứa app component
      // Cần parse và lưu app component từ response
      if (componentName === 'actions' && response.data) {
        // Kiểm tra xem response có chứa app component không
        // App component có thể được tạo từ response của actions component
        if (response.data.effects && response.data.effects.html) {
          // Parse HTML để tìm app component
          const $ = cheerio.load(response.data.effects.html);
          const appElement = $('[wire\\:id][wire\\:initial-data]').filter((i, el) => {
            const wireData = $(el).attr('wire:initial-data');
            if (wireData) {
              try {
                const decoded = wireData
                  .replace(/&quot;/g, '"')
                  .replace(/&#039;/g, "'")
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>');
                const parsed = JSON.parse(decoded);
                return parsed.fingerprint && parsed.fingerprint.name === 'frontend.app';
              } catch (e) {
                return false;
              }
            }
            return false;
          });
          
          if (appElement.length > 0) {
            const wireData = appElement.first().attr('wire:initial-data');
            try {
              const decoded = wireData
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'")
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');
              const parsed = JSON.parse(decoded);
              if (parsed.fingerprint && parsed.fingerprint.name === 'frontend.app') {
                this.componentFingerprints.app = parsed.fingerprint;
                this.componentServerMemos.app = parsed.serverMemo;
                console.log('✓ Tìm thấy app component trong response - ID:', parsed.fingerprint.id);
              }
            } catch (e) {
              // Ignore
            }
          }
        }
      }

      // Nếu có redirect, fetch HTML mới
      if (response.data && response.data.effects && response.data.effects.redirect) {
        await this.fetchAndUpdateComponentData(response.data.effects.redirect);
      }

      return response.data;
    } catch (error) {
      // Nếu lỗi 419 (CSRF token mismatch), re-initialize và retry 1 lần
      if (error.response && error.response.status === 419) {
        console.log('⚠️  Lỗi 419 - CSRF token mismatch, đang re-initialize...');
        
        // Re-initialize session
        await this.initialize();
        
        // Retry request với CSRF token mới
        requestHeaders['X-CSRF-TOKEN'] = this.csrfToken;
        
        const retryResponse = await axios.post(
          `${this.baseURL}${this.apiEndpoint}/${componentName}`,
          payload,
          {
            headers: requestHeaders,
            withCredentials: true
          }
        );
        
        // Update cookies và server memo từ retry response
        const setCookies = retryResponse.headers['set-cookie'];
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
        
        if (retryResponse.data && retryResponse.data.serverMemo) {
          this.componentServerMemos[componentName] = retryResponse.data.serverMemo;
        }
        
        if (retryResponse.data && retryResponse.data.effects && retryResponse.data.effects.redirect) {
          await this.fetchAndUpdateComponentData(retryResponse.data.effects.redirect);
        }
        
        return retryResponse.data;
      }
      
      console.error('Lỗi gửi request:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Lấy danh sách domains
   */
  getDomains() {
    if (this.componentServerMemos.actions && this.componentServerMemos.actions.data) {
      return this.componentServerMemos.actions.data.domains || [];
    }
    return [];
  }

  /**
   * Lấy email hiện tại
   */
  getCurrentEmail() {
    if (this.componentServerMemos.actions && this.componentServerMemos.actions.data) {
      return this.componentServerMemos.actions.data.email || null;
    }
    return null;
  }

  /**
   * Lấy danh sách emails
   */
  getAllEmails() {
    if (this.componentServerMemos.actions && this.componentServerMemos.actions.data) {
      return this.componentServerMemos.actions.data.emails || [];
    }
    return [];
  }

  /**
   * Set domain
   */
  async setDomain(domain) {
    const fingerprint = this.componentFingerprints.actions;
    if (!fingerprint) {
      throw new Error('Actions component chưa được khởi tạo');
    }

    const updates = [
      {
        type: 'callMethod',
        payload: {
          id: this.generateId(),
          method: 'setDomain',
          params: [domain]
        }
      }
    ];

    const response = await this.sendRequest('actions', updates);
    
    // Update domain trong server memo
    if (response.serverMemo && response.serverMemo.data) {
      this.componentServerMemos.actions.data.domain = domain;
    }

    return response;
  }

  /**
   * Set user (username)
   */
  async setUser(username) {
    const fingerprint = this.componentFingerprints.actions;
    if (!fingerprint) {
      throw new Error('Actions component chưa được khởi tạo');
    }

    const updates = [
      {
        type: 'syncInput',
        payload: {
          id: this.generateId(),
          name: 'user',
          value: username
        }
      }
    ];

    const response = await this.sendRequest('actions', updates);
    
    // Update user trong server memo
    if (response.serverMemo && response.serverMemo.data) {
      this.componentServerMemos.actions.data.user = username;
    }

    return response;
  }

  /**
   * Tạo email ngẫu nhiên
   * iMail có method random trực tiếp
   */
  async createRandomEmail() {
    try {
    const fingerprint = this.componentFingerprints.actions;
    if (!fingerprint) {
        return { success: false, error: 'Actions component chưa được khởi tạo. Vui lòng init trước.' };
    }

    const currentMemo = this.componentServerMemos.actions;
    if (!currentMemo) {
        return { success: false, error: 'Actions serverMemo chưa được khởi tạo. Vui lòng init trước.' };
    }

    // Gọi method random
    const updates = [
      {
        type: 'callMethod',
        payload: {
          id: this.generateId(),
          method: 'random',
          params: []
        }
      }
    ];

    const response = await this.sendRequest('actions', updates);
    
    // Sau khi gọi random, email sẽ được tạo và có thể nằm trong serverMemo
    // Hoặc cần fetch lại từ mailbox để lấy email mới nhất
    let email = response.serverMemo?.data?.email;
    
    // Nếu không có trong response, lấy từ componentServerMemos (đã được merge)
    if (!email) {
      email = this.componentServerMemos.actions?.data?.email;
    }
    
    // Nếu vẫn không có, có thể cần fetch lại từ mailbox
    if (!email) {
        try {
      // Fetch mailbox để lấy email mới nhất
      await this.fetchAndUpdateComponentData(`${this.baseURL}/mailbox`);
      email = this.componentServerMemos.actions?.data?.email;
        } catch (fetchError) {
          console.warn('Lỗi khi fetch mailbox:', fetchError.message);
          // Tiếp tục tìm email từ nguồn khác
        }
    }
    
    // Lấy từ emails array (email mới nhất)
    if (!email) {
      const emails = this.componentServerMemos.actions?.data?.emails;
      if (emails && Array.isArray(emails)) {
        // Xử lý Livewire format: [[...], {"s": "arr"}]
        let emailArray = emails;
        if (Array.isArray(emails) && emails.length === 2 && 
            typeof emails[1] === 'object' && emails[1].s === 'arr') {
          emailArray = emails[0];
        }
        if (Array.isArray(emailArray) && emailArray.length > 0) {
          email = emailArray[emailArray.length - 1]; // Lấy email cuối cùng (mới nhất)
        }
      }
    }
    
    if (email) {
        // Sync email và fetch messages (có thể fail nhưng không ảnh hưởng đến việc tạo email)
        try {
      await this.syncEmail(email);
        } catch (syncError) {
          console.warn('Lỗi khi sync email (có thể không ảnh hưởng):', syncError.message);
        }
        
        try {
      await this.fetchMessages();
        } catch (fetchError) {
          console.warn('Lỗi khi fetch messages (có thể không ảnh hưởng):', fetchError.message);
        }
        
      return { success: true, email: email };
    }

      return { success: false, error: 'Không thể tạo email ngẫu nhiên. Không tìm thấy email sau khi tạo.' };
    } catch (error) {
      console.error('Lỗi trong createRandomEmail:', error.message);
      console.error('Stack:', error.stack);
      return { success: false, error: `Lỗi khi tạo email: ${error.message}` };
    }
  }

  /**
   * Tạo email với username tùy chỉnh
   */
  async createEmail(username, domain = null) {
    // Validate username
    if (!username || username.trim().length < 3) {
      return { success: false, error: 'Username phải có ít nhất 3 ký tự' };
    }
    
    if (username.trim().length > 15) {
      return { success: false, error: 'Username không được vượt quá 15 ký tự' };
    }

    username = username.trim();

    const fingerprint = this.componentFingerprints.actions;
    if (!fingerprint) {
      throw new Error('Actions component chưa được khởi tạo');
    }

    // Chọn domain: nếu không có thì dùng domain đầu tiên
    const domains = this.getDomains();
    if (domains.length === 0) {
      return { success: false, error: 'Không có domain nào' };
    }
    
    const selectedDomain = domain || domains[0];

    // BƯỚC 1: Set user và domain (giống API gốc)
    const updates1 = [
      {
        type: 'syncInput',
        payload: {
          id: this.generateId(),
          name: 'user',
          value: username
        }
      },
      {
        type: 'callMethod',
        payload: {
          id: this.generateId(),
          method: 'setDomain',
          params: [selectedDomain]
        }
      }
    ];

    let response1;
    try {
      response1 = await this.sendRequest('actions', updates1);
    } catch (error) {
      console.error('✗ Lỗi request 1 (setDomain):', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      return { success: false, error: `Lỗi set domain: ${error.message}` };
    }
    
    // QUAN TRỌNG: Cập nhật serverMemo từ response1 trước khi gọi request 2
    if (response1 && response1.serverMemo) {
      // Merge serverMemo (giữ lại các field cũ, chỉ cập nhật data và checksum)
      const currentMemo = this.componentServerMemos.actions;
      if (currentMemo) {
        // Merge data: giữ lại các field cũ trong data (in_app, domains, emails), chỉ cập nhật những field mới
        const mergedData = {
          ...currentMemo.data,  // Giữ lại tất cả field cũ trong data
          ...response1.serverMemo.data  // Cập nhật với data mới từ response
        };
        
        // Merge serverMemo: giữ lại các field cũ, chỉ cập nhật data và checksum
        const mergedMemo = {
          ...currentMemo,  // Giữ lại tất cả field cũ (children, errors, htmlHash, dataMeta)
          data: mergedData,  // Merge data
          checksum: response1.serverMemo.checksum || currentMemo.checksum  // Cập nhật checksum
        };
        
        // Cập nhật htmlHash nếu có trong response
        if (response1.serverMemo.htmlHash) {
          mergedMemo.htmlHash = response1.serverMemo.htmlHash;
        }
        
        this.componentServerMemos.actions = mergedMemo;
        console.log('✓ Updated serverMemo after setDomain - checksum:', mergedMemo.checksum);
        console.log('  - Has children:', !!mergedMemo.children);
        console.log('  - Has errors:', !!mergedMemo.errors);
        console.log('  - Has htmlHash:', !!mergedMemo.htmlHash);
        console.log('  - Has dataMeta:', !!mergedMemo.dataMeta);
        console.log('  - Data keys:', Object.keys(mergedMemo.data || {}));
      } else {
        // Nếu chưa có, tạo serverMemo đầy đủ
        this.componentServerMemos.actions = {
          children: [],
          errors: [],
          htmlHash: response1.serverMemo.htmlHash || '',
          data: response1.serverMemo.data || {},
          dataMeta: [],
          checksum: response1.serverMemo.checksum || ''
        };
        console.log('✓ Created new serverMemo from response1');
      }
    } else {
      console.error('✗ Không có serverMemo trong response1');
      return { success: false, error: 'Không nhận được serverMemo từ server' };
    }
    
    // BƯỚC 2: Gọi create (sau khi đã set user và domain)
    const updates2 = [
      {
        type: 'callMethod',
        payload: {
          id: this.generateId(),
          method: 'create',
          params: []
        }
      }
    ];

    const response2 = await this.sendRequest('actions', updates2);
    
    // Nếu có redirect, fetch HTML từ redirect URL
    if (response2.effects && response2.effects.redirect) {
      await this.fetchAndUpdateComponentData(response2.effects.redirect);
      
      // Lấy email từ server memo sau khi redirect
      const email = this.componentServerMemos.actions?.data?.email;
      if (email) {
        // Sync email và fetch messages
        await this.syncEmail(email);
        await this.fetchMessages();
        return { success: true, email: email };
      }
    }

    // Lấy email từ response
    const email = response2.serverMemo?.data?.email;
    if (email) {
      await this.syncEmail(email);
      await this.fetchMessages();
      return { success: true, email: email };
    }

    return { success: false, error: 'Không thể tạo email' };
  }

  /**
   * Sync email
   */
  /**
   * Tạo app component từ actions component hoặc từ API
   * App component không có trong HTML, cần tạo từ response hoặc từ actions component
   */
  async ensureAppComponent() {
    // Nếu đã có app component, return
    if (this.componentFingerprints.app && this.componentServerMemos.app) {
      return true;
    }
    
    console.log('⚠️  App component chưa có, đang tạo...');
    
    // Cách 1: Thử fetch /mailbox để lấy app component
    try {
      await this.fetchAndUpdateComponentData(`${this.baseURL}/mailbox`);
      if (this.componentFingerprints.app && this.componentServerMemos.app) {
        console.log('✓ Đã lấy app component từ /mailbox');
        return true;
      }
    } catch (error) {
      console.warn('⚠️  Không thể fetch /mailbox:', error.message);
    }
    
    // Cách 2: Tạo app component từ actions component
    // App component có thể được tạo bằng cách gọi API với fingerprint và serverMemo mặc định
    if (this.componentFingerprints.actions && this.componentServerMemos.actions) {
      try {
        // Tạo fingerprint và serverMemo mặc định cho app component
        // Dựa vào actions component để tạo app component tương tự
        const appFingerprint = {
          id: this.generateId(), // Tạo ID mới
          name: 'frontend.app',
          locale: this.componentFingerprints.actions.locale || 'vi',
          path: 'mailbox',
          method: 'GET',
          v: this.componentFingerprints.actions.v || 'acj'
        };
        
        const appServerMemo = {
          children: [],
          errors: [],
          htmlHash: '',
          data: {
            messages: [],
            deleted: [],
            error: '',
            email: this.componentServerMemos.actions?.data?.email || null,
            initial: true,
            overflow: false
          },
          dataMeta: [],
          checksum: ''
        };
        
        // Cách 2: Không tạo app component từ API vì server trả về 500
        // Thay vào đó, tạo app component với fingerprint và serverMemo mặc định
        // và để nó được update từ response khi gọi API lần đầu
        // Lưu app component với fingerprint và serverMemo mặc định
        this.componentFingerprints.app = appFingerprint;
        this.componentServerMemos.app = appServerMemo;
        console.log('✓ Đã tạo app component mặc định - ID:', appFingerprint.id);
        console.log('⚠️  App component sẽ được update từ response khi gọi API lần đầu');
        return true;
      } catch (error) {
        console.warn('⚠️  Không thể tạo app component từ API:', error.message);
      }
    }
    
    return false;
  }

  async syncEmail(email) {
    // QUAN TRỌNG: Đảm bảo app component đã được init
    if (!this.componentFingerprints.app || !this.componentServerMemos.app) {
      const created = await this.ensureAppComponent();
      if (!created) {
        throw new Error('Không thể tạo app component. Vui lòng thử lại.');
      }
    }
    
    const fingerprint = this.componentFingerprints.app;

    const updates = [
      {
        type: 'fireEvent',
        payload: {
          id: this.generateId(),
          event: 'syncEmail',
          params: [email]
        }
      }
    ];

    return await this.sendRequest('app', updates);
  }

  /**
   * Fetch messages
   */
  async fetchMessages() {
    // QUAN TRỌNG: Đảm bảo app component đã được init
    if (!this.componentFingerprints.app || !this.componentServerMemos.app) {
      const created = await this.ensureAppComponent();
      if (!created) {
        throw new Error('Không thể tạo app component. Vui lòng thử lại.');
      }
    }
    
    const fingerprint = this.componentFingerprints.app;

    const updates = [
      {
        type: 'fireEvent',
        payload: {
          id: this.generateId(),
          event: 'fetchMessages',
          params: []
        }
      }
    ];

    const response = await this.sendRequest('app', updates);
    
    // QUAN TRỌNG: Messages nằm trong serverMemo.data.messages
    // Response từ sendRequest có serverMemo với đầy đủ messages (đã được merge)
    let messages = [];
    
    // Ưu tiên lấy từ response.serverMemo.data.messages (response mới nhất từ server)
    if (response && response.serverMemo && response.serverMemo.data && response.serverMemo.data.messages !== undefined) {
      let rawMessages = response.serverMemo.data.messages;
      
      // Debug: Log raw messages để xem format
      console.log('🔍 Raw messages from response:', {
        type: typeof rawMessages,
        isArray: Array.isArray(rawMessages),
        length: Array.isArray(rawMessages) ? rawMessages.length : 'N/A',
        preview: Array.isArray(rawMessages) && rawMessages.length > 0 
          ? `First message ID: ${rawMessages[0]?.id || 'N/A'}` 
          : 'Empty'
      });
      
      // Xử lý Livewire format: [[...], {"s": "arr"}]
      if (Array.isArray(rawMessages) && rawMessages.length === 2 && 
          typeof rawMessages[1] === 'object' && rawMessages[1].s === 'arr') {
        messages = Array.isArray(rawMessages[0]) ? rawMessages[0] : [];
        console.log(`✓ Parse Livewire format - Lấy ${messages.length} message(s)`);
      }
      // Xử lý array bình thường
      else if (Array.isArray(rawMessages)) {
        messages = rawMessages;
        console.log(`✓ Lấy ${messages.length} message(s) từ response.serverMemo.data.messages (array)`);
      }
      // Nếu không phải array, thử convert
      else {
        console.log('⚠️ messages không phải array, type:', typeof rawMessages);
        messages = [];
      }
    } 
    // Fallback: Lấy từ componentServerMemos (đã được merge sau sendRequest)
    else if (this.componentServerMemos.app && this.componentServerMemos.app.data && this.componentServerMemos.app.data.messages !== undefined) {
      let rawMessages = this.componentServerMemos.app.data.messages;
      
      console.log('⚠️ Không có messages trong response, lấy từ componentServerMemos');
      
      // Xử lý Livewire format
      if (Array.isArray(rawMessages) && rawMessages.length === 2 && 
          typeof rawMessages[1] === 'object' && rawMessages[1].s === 'arr') {
        messages = Array.isArray(rawMessages[0]) ? rawMessages[0] : [];
        console.log(`✓ Parse Livewire format từ componentServerMemos - Lấy ${messages.length} message(s)`);
      }
      // Xử lý array bình thường
      else if (Array.isArray(rawMessages)) {
        messages = rawMessages;
        console.log(`✓ Lấy ${messages.length} message(s) từ componentServerMemos.app.data.messages (array)`);
      }
      else {
        messages = [];
      }
    }
    
    // Debug log nếu không tìm thấy
    if (messages.length === 0) {
      console.log('⚠️ Không tìm thấy messages hoặc messages rỗng');
      if (response && response.serverMemo && response.serverMemo.data) {
        console.log('  - response.serverMemo.data keys:', Object.keys(response.serverMemo.data));
        console.log('  - messages value:', response.serverMemo.data.messages);
        console.log('  - messages type:', typeof response.serverMemo.data.messages);
      }
    }
    
    // Format messages để đồng nhất với TMail format
    messages = messages.map((msg, index) => {
      // Format content nếu có
      let formattedContent = msg.content || '';
      if (formattedContent && typeof formattedContent === 'string') {
        try {
          formattedContent = this.formatEmailContent(formattedContent);
        } catch (e) {
          // Nếu lỗi format, dùng content gốc
          formattedContent = msg.content || '';
        }
      }
      
      return {
        id: msg.id || `msg-${index}`,
        subject: msg.subject || 'Không có tiêu đề',
        sender_name: msg.sender_name || 'Không rõ',
        sender_email: msg.sender_email || '',
        date: msg.date || null,
        datediff: msg.datediff || null,
        timestamp: msg.timestamp || null,
        content: formattedContent,
        content_raw: msg.content || '',
        attachments: msg.attachments || []
      };
    });

    return {
      success: true,
      messages: messages,
      count: messages.length
    };
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
      
      // Lấy body content
      let body = $('body').length ? $('body') : $('html');
      if (!body.length) body = cheerio.load('<div>' + html + '</div>')('div');
      
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
      // Fallback: trả về HTML gốc nếu format lỗi
      return html.substring(0, 1000);
    }
  }

  /**
   * Parse messages từ HTML (backup method, không dùng nữa)
   */
  parseMessagesFromHtml(html) {
    const messages = [];
    try {
      const $ = cheerio.load(html);
      
      // Tìm các message elements (cần điều chỉnh selector dựa trên HTML thực tế)
      $('.message, [data-message-id]').each((i, el) => {
        const $el = $(el);
        const message = {
          id: $el.attr('data-message-id') || $el.attr('id') || `msg-${i}`,
          subject: $el.find('.subject, .message-subject').text().trim() || 'Không có tiêu đề',
          sender_name: $el.find('.sender, .message-sender').text().trim() || 'Không rõ',
          sender_email: $el.find('.sender-email, .message-sender-email').text().trim() || '',
          date: $el.find('.date, .message-date').text().trim() || '',
          content: $el.find('.content, .message-content').html() || '',
          content_raw: $el.find('.content, .message-content').html() || ''
        };
        
        if (message.id) {
          messages.push(message);
        }
      });
    } catch (e) {
      console.error('Lỗi parse messages từ HTML:', e.message);
    }

    return messages;
  }

  /**
   * Generate random ID
   */
  generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Bắt đầu polling để check mail mới
   * @param {number} interval - Khoảng thời gian giữa các lần gọi (ms), mặc định 3000ms (3 giây)
   * @param {Function} callback - Callback được gọi mỗi khi có kết quả fetchMessages
   */
  startPolling(interval = 3000, callback = null) {
    if (this.isPolling) {
      console.log('⚠️ Polling đã được bắt đầu');
      return;
    }

    this.isPolling = true;
    this.pollingCallback = callback;

    console.log(`🔄 Bắt đầu polling với interval ${interval}ms`);

    // Gọi ngay lần đầu
    this.pollMessages();

    // Sau đó gọi định kỳ
    this.pollingInterval = setInterval(() => {
      this.pollMessages();
    }, interval);
  }

  /**
   * Dừng polling
   */
  stopPolling() {
    if (!this.isPolling) {
      return;
    }

    this.isPolling = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.pollingCallback = null;
    console.log('⏹️ Đã dừng polling');
  }

  /**
   * Thực hiện poll messages (gọi fetchMessages)
   */
  async pollMessages() {
    try {
      const result = await this.fetchMessages();
      
      // Gọi callback nếu có
      if (this.pollingCallback && typeof this.pollingCallback === 'function') {
        this.pollingCallback(result);
      }
      
      return result;
    } catch (error) {
      console.error('❌ Lỗi khi poll messages:', error.message);
      
      // Gọi callback với error nếu có
      if (this.pollingCallback && typeof this.pollingCallback === 'function') {
        this.pollingCallback({
          success: false,
          error: error.message,
          messages: [],
          count: 0
        });
      }
      
      return {
        success: false,
        error: error.message,
        messages: [],
        count: 0
      };
    }
  }
}

