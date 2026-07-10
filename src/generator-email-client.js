import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Generator Email Client
 * Client kết nối với generator.email
 * Hỗ trợ WebSocket (Socket.IO) cho real-time notifications
 * và HTTP scraping cho message fetching
 */
export class GeneratorEmailClient {
    constructor() {
        this.baseURL = 'https://generator.email';
        this.wsURL = 'wss://generator.email';
        this.domains = [];
        this.currentEmail = null;
        this.currentDomain = null;
        this.currentUsername = null;
        this.surlHash = null; // Hash từ JS của trang, cần cho cookie surl
        this.cookies = {};
        this.socketClient = null;
        this.isWatching = false;
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    }

    /**
     * HTTP GET với retry logic cho socket hang up errors
     */
    async httpGet(url, headers = {}, maxRetries = 3) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': this.baseURL,
                        'Cookie': this.getCookieString(),
                        ...headers
                    },
                    maxRedirects: 10,
                    timeout: 15000
                });
                // Lưu cookies từ response
                this.saveCookiesFromResponse(response);
                return response;
            } catch (error) {
                lastError = error;
                const isRetryable = error.code === 'ECONNRESET' ||
                    error.message?.includes('socket hang up') ||
                    error.message?.includes('ETIMEDOUT');
                if (isRetryable && attempt < maxRetries) {
                    console.log(`[GeneratorEmail] Retry ${attempt}/${maxRetries} for ${url}: ${error.message}`);
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    /**
     * Lưu cookies từ response headers
     */
    saveCookiesFromResponse(response) {
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
    }

    /**
     * Trích xuất surl hash từ JavaScript trong HTML response
     * Trang generator.email nhúng hash vào: document.cookie = "surl=" + smurl + "/HASH" + "; expires=..."
     */
    extractSurlHash(html) {
        // Pattern 1: tìm hash 32 ký tự hex sau smurl+"/"
        const match = html.match(/smurl\s*\+\s*["']\/([a-f0-9]{32})["']/i);
        if (match) return match[1];
        // Pattern 2: tìm trong cookie assignment: surl=.../{hash}
        const match2 = html.match(/surl=[^;]*\/([a-f0-9]{32})/i);
        if (match2) return match2[1];
        // Pattern 3: tìm hash đứng sau chuỗi "+"/"+" (JS concat)
        const match3 = html.match(/\+\s*["']\/["']\s*\+\s*["']([a-f0-9]{32})["']/i);
        if (match3) return match3[1];
        return null;
    }

    /**
     * Khởi tạo client - fetch homepage để lấy cookies và domain list
     */
    async initialize() {
        try {
            const response = await this.httpGet(this.baseURL);

            // Parse domains từ HTML dropdown
            const $ = cheerio.load(response.data);
            const parsedDomains = [];
            $('.tt-suggestion p').each((i, el) => {
                const domain = $(el).text().trim();
                if (domain && domain.includes('.')) {
                    parsedDomains.push(domain);
                }
            });

            if (parsedDomains.length > 0) {
                this.domains = parsedDomains;
            }

            // Nếu không parse được từ dropdown, thử lấy từ input value
            if (this.domains.length === 0) {
                const domainInput = $('#domainName2').val();
                if (domainInput) {
                    this.domains.push(domainInput);
                }
            }

            // Fallback domains nếu vẫn không có
            if (this.domains.length === 0) {
                this.domains = [
                    'inly.vn', 'ardsp.shop', 'c-newstv.ru', 'nguyentinhblog.com',
                    'naverly.com', 'adarsa.me', 'jika.gg', 'co2uk.shop',
                    'natachai.me', 'otp247.me', 'wochaojibang.sbs', 'quangvps.com'
                ];
            }

            console.log(`[GeneratorEmail] Initialized with ${this.domains.length} domains`);
            return true;
        } catch (error) {
            console.error('[GeneratorEmail] Error initializing:', error.message);
            return false;
        }
    }

    /**
     * Lấy danh sách domains
     */
    getDomains() {
        return this.domains;
    }

    /**
     * Tìm kiếm domains theo từ khóa
     */
    async searchDomains(query) {
        try {
            const response = await axios.get(`${this.baseURL}/search.php`, {
                params: { key: query },
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': this.baseURL,
                    'Cookie': this.getCookieString()
                },
                timeout: 10000
            });

            if (Array.isArray(response.data)) {
                return response.data.map(item => item.value || item);
            }
            return [];
        } catch (error) {
            console.error('[GeneratorEmail] Error searching domains:', error.message);
            return [];
        }
    }

    /**
     * Validate domain qua API
     */
    async validateDomain(username, domain) {
        try {
            const response = await axios.post(
                `${this.baseURL}/check_adres_validation3.php`,
                `usr=${encodeURIComponent(username)}&dmn=${encodeURIComponent(domain)}`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': this.userAgent,
                        'Accept': '*/*',
                        'Origin': this.baseURL,
                        'Referer': this.baseURL,
                        'Cookie': this.getCookieString()
                    },
                    timeout: 10000
                }
            );

            const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            return {
                valid: data.status === 'good',
                uptime: data.uptime || null,
                status: data.status
            };
        } catch (error) {
            console.error('[GeneratorEmail] Error validating domain:', error.message);
            return { valid: false, status: 'error' };
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
     * Generate random username
     */
    generateRandomUsername(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        // Đảm bảo bắt đầu bằng chữ cái
        result += chars.charAt(Math.floor(Math.random() * 26));
        for (let i = 1; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * Tạo email random
     */
    async createRandomEmail() {
        const username = this.generateRandomUsername();
        const domain = this.domains.length > 0
            ? this.domains[Math.floor(Math.random() * this.domains.length)]
            : 'inly.vn';
        return await this.createEmail(username, domain);
    }

    /**
     * Tạo email với username và domain
     */
    async createEmail(username, domain = null) {
        try {
            // Validate và clean username
            if (!username) {
                username = this.generateRandomUsername();
            }
            username = username.replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
            if (username.length > 25) {
                username = username.substring(0, 25);
            }
            if (username.length < 1) {
                return { success: false, error: 'Username phải có ít nhất 1 ký tự' };
            }

            // Chọn domain
            const selectedDomain = domain && this.domains.includes(domain)
                ? domain
                : (this.currentDomain || (this.domains.length > 0 ? this.domains[0] : null));

            if (!selectedDomain) {
                return { success: false, error: 'Không có domain khả dụng' };
            }

            // Validate domain trước khi tạo email
            const validation = await this.validateDomain(username, selectedDomain);
            if (!validation.valid) {
                console.warn(`[GeneratorEmail] Domain ${selectedDomain} không hợp lệ (status: ${validation.status})`);
            }

            const email = `${username}@${selectedDomain}`;
            const smurl = `${selectedDomain.toLowerCase()}/${username.toLowerCase()}`;

            // QUAN TRỌNG: Clear surl cookie cũ trước khi tạo email mới
            // Cookie surl cũ từ email trước gây redirect loop
            delete this.cookies['surl'];
            this.surlHash = null;

            // Fetch inbox page để "activate" mailbox và lấy surl hash
            try {
                const inboxResponse = await this.httpGet(`${this.baseURL}/${smurl}`);

                // Trích xuất surl hash từ JavaScript trong page
                const hash = this.extractSurlHash(inboxResponse.data);
                if (hash) {
                    this.surlHash = hash;
                    this.cookies['surl'] = `${smurl}/${hash}`;
                    console.log(`[GeneratorEmail] Got surl hash: ${hash.substring(0, 8)}...`);
                } else {
                    // Fallback: set surl without hash
                    this.cookies['surl'] = smurl;
                    console.warn('[GeneratorEmail] Could not extract surl hash, using path only');
                }
            } catch (error) {
                console.warn('[GeneratorEmail] Error activating mailbox (non-fatal):', error.message);
                this.cookies['surl'] = smurl;
            }

            this.currentEmail = email;
            this.currentDomain = selectedDomain;
            this.currentUsername = username;

            return {
                success: true,
                email: email,
                username: username,
                domain: selectedDomain
            };
        } catch (error) {
            console.error('[GeneratorEmail] Error creating email:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Fetch messages từ inbox bằng cách scrape HTML
     */
    async fetchMessages() {
        try {
            if (!this.currentEmail) {
                return { success: true, error: null, messages: [], count: 0 };
            }

            const [username, domain] = this.currentEmail.split('@');
            if (!username || !domain) {
                return { success: false, error: 'Email không hợp lệ', messages: [], count: 0 };
            }

            const smurl = `${domain.toLowerCase()}/${username.toLowerCase()}`;

            // Đảm bảo surl cookie được set đúng
            if (!this.cookies['surl'] || !this.cookies['surl'].includes('/')) {
                if (this.surlHash) {
                    this.cookies['surl'] = `${smurl}/${this.surlHash}`;
                } else {
                    this.cookies['surl'] = smurl;
                }
            }

            const response = await this.httpGet(`${this.baseURL}/${smurl}`);
            const html = response.data;

            // Cập nhật surl hash nếu chưa có
            if (!this.surlHash) {
                const hash = this.extractSurlHash(html);
                if (hash) {
                    this.surlHash = hash;
                    this.cookies['surl'] = `${smurl}/${hash}`;
                }
            }

            // Kiểm tra xem page có inbox hay không
            if (!html.includes('email-table')) {
                // Trang không có inbox → chưa có email hoặc cần surl cookie
                // Thử lại với surl cookie mới nếu vừa extract được hash
                if (this.surlHash && !this.cookies['surl'].includes(this.surlHash)) {
                    this.cookies['surl'] = `${smurl}/${this.surlHash}`;
                    const retryResponse = await this.httpGet(`${this.baseURL}/${smurl}`);
                    if (retryResponse.data.includes('email-table')) {
                        return this.parseInboxHtml(retryResponse.data);
                    }
                }
                return { success: true, messages: [], count: 0 };
            }

            return this.parseInboxHtml(html);
        } catch (error) {
            console.error('[GeneratorEmail] Error fetching messages:', error.message);
            return { success: true, error: error.message, messages: [], count: 0 };
        }
    }

    /**
     * Parse inbox HTML để trích xuất danh sách messages
     */
    parseInboxHtml(html) {
        const $ = cheerio.load(html);
        const messages = [];

        // Trích xuất surl hash từ JS - đây là message ID của email đang mở (expanded)
        const expandedMsgHash = this.extractSurlHash(html);

        // Tìm nội dung email đang mở (expanded) từ iddelet2 div
        let expandedContent = '';
        const iddelet2 = $('#iddelet2');
        if (iddelet2.length > 0) {
            const messBody = iddelet2.find('.mess_bodiyy');
            if (messBody.length > 0) {
                expandedContent = messBody.html() || '';
            }
        }

        // Parse email table - mỗi email là một thẻ <a> hoặc <div> trong #email-table
        let expandedMsgAssigned = false;
        $('#email-table').children().each((i, el) => {
            const $el = $(el);
            const tagName = el.tagName?.toLowerCase();

            // Skip ads và script elements
            if (tagName === 'script' || tagName === 'ins') return;

            // Email items có class list-group-item
            if (!$el.hasClass('list-group-item')) return;

            const from = $el.find('.from_div_45g45gg').first().text().trim();
            const subject = $el.find('.subj_div_45g45gg').first().text().trim();
            const time = $el.find('.time_div_45g45gg').first().text().trim();

            // Skip nếu thiếu thông tin cơ bản
            if (!from && !subject) return;

            // Lấy message ID từ href hoặc id
            let messageId = '';
            let content = '';

            if (tagName === 'a') {
                const href = $el.attr('href') || '';
                // href format: /{domain}/{username}/{hash}
                const parts = href.split('/').filter(p => p);
                if (parts.length >= 3) {
                    messageId = parts[parts.length - 1];
                }
            } else {
                // Div expanded (iddelet1) → dùng surl hash làm message ID
                const elId = $el.attr('id') || '';
                if ((elId === 'iddelet1' || $el.hasClass('list-group-item-info')) && expandedMsgHash && !expandedMsgAssigned) {
                    messageId = expandedMsgHash;
                    content = expandedContent; // Gán body từ iddelet2
                    expandedMsgAssigned = true;
                }
            }

            // Parse email body nếu có trong element hiện tại
            if (!content) {
                const messageBody = $el.find('.mess_bodiyy').html();
                if (messageBody) {
                    content = messageBody;
                }
            }

            // Skip nếu vẫn không có messageId (fallback ID cho trường hợp lạ)
            if (!messageId) {
                messageId = expandedMsgHash || `msg-${i}`;
            }

            messages.push({
                id: messageId,
                m_id: messageId,
                subject: subject || 'Không có tiêu đề',
                sender_name: from,
                sender_email: from,
                to: this.currentEmail,
                date: time || null,
                datediff: this.calculateDateDiff(time),
                timestamp: time ? new Date(time + ' UTC').getTime() : null,
                content: content,
                content_raw: content,
                hasAttm: 0,
                attachments: []
            });
        });

        // Deduplicate: nếu có expanded message, nó thường trùng với list item
        const uniqueMessages = [];
        const seenSubjects = new Set();
        for (const msg of messages) {
            const key = `${msg.sender_email}|${msg.subject}|${msg.date}`;
            if (!seenSubjects.has(key)) {
                seenSubjects.add(key);
                uniqueMessages.push(msg);
            } else if (msg.content) {
                const idx = uniqueMessages.findIndex(m =>
                    `${m.sender_email}|${m.subject}|${m.date}` === key
                );
                if (idx >= 0) {
                    uniqueMessages[idx] = msg;
                }
            }
        }

        return {
            success: true,
            messages: uniqueMessages,
            count: uniqueMessages.length
        };
    }

    /**
     * Lấy chi tiết message (body email đầy đủ)
     */
    async getMessageDetail(messageId) {
        try {
            if (!this.currentEmail) {
                return { success: false, error: 'Chưa có email nào được chọn' };
            }

            const [username, domain] = this.currentEmail.split('@');
            if (!username || !domain) {
                return { success: false, error: 'Email không hợp lệ' };
            }

            // Với ID tạm (expanded-X, msg-X), lấy content từ inbox page
            if (messageId.startsWith('expanded-') || messageId.startsWith('msg-')) {
                const msgsResult = await this.fetchMessages();
                if (msgsResult.success && msgsResult.messages.length > 0) {
                    // Tìm message theo ID hoặc lấy message đầu tiên có content
                    let msg = msgsResult.messages.find(m => m.id === messageId);
                    if (!msg || !msg.content) {
                        msg = msgsResult.messages.find(m => m.content);
                    }
                    if (msg && msg.content) {
                        return {
                            success: true,
                            content: msg.content,
                            content_raw: msg.content_raw || msg.content,
                            html: msg.content,
                            subject: msg.subject || '',
                            from: msg.sender_email || '',
                            to: msg.to || this.currentEmail || '',
                            date: msg.date || null
                        };
                    }
                }
                return { success: false, error: 'Không tìm thấy message' };
            }

            // Đảm bảo surl cookie được set
            const smurl = `${domain.toLowerCase()}/${username.toLowerCase()}`;
            if (!this.cookies['surl'] || !this.cookies['surl'].includes('/')) {
                if (this.surlHash) {
                    this.cookies['surl'] = `${smurl}/${this.surlHash}`;
                } else {
                    this.cookies['surl'] = smurl;
                }
            }

            // Fetch message detail page (URL: /{domain}/{username}/{messageId})
            const url = `${this.baseURL}/${smurl}/${messageId}`;
            const response = await this.httpGet(url);

            const $ = cheerio.load(response.data);

            // Parse email body
            let body = '';
            const messBody = $('.mess_bodiyy');
            if (messBody.length > 0) {
                body = messBody.html() || '';
            }

            // Parse email metadata
            let from = '';
            let subject = '';
            let to = this.currentEmail;
            let date = '';

            // Tìm trong phần message detail (#message div)
            const messageDiv = $('#message');
            if (messageDiv.length > 0) {
                const spans = messageDiv.find('span');
                spans.each((i, el) => {
                    const text = $(el).text().trim();
                    const prevText = $(el).prev().text().trim();

                    if (prevText === 'From:' || prevText.endsWith('From:')) {
                        from = text;
                    }
                    if (prevText === 'To:' || prevText.endsWith('To:')) {
                        to = text;
                    }
                });

                // Subject thường nằm trong h1
                const h1 = messageDiv.find('h1');
                if (h1.length > 0) {
                    subject = h1.text().trim();
                }
            }

            // Fallback: Parse từ list item nếu đang ở inbox page
            if (!subject) {
                const activeItem = $('.list-group-item-info');
                if (activeItem.length > 0) {
                    from = activeItem.find('.from_div_45g45gg').text().trim() || from;
                    subject = activeItem.find('.subj_div_45g45gg').text().trim() || subject;
                    date = activeItem.find('.time_div_45g45gg').text().trim() || date;
                }
            }

            // Tìm received time
            const receivedSpans = messageDiv ? messageDiv.find('span') : $();
            receivedSpans.each((i, el) => {
                const prevText = $(el).prev().text().trim();
                if (prevText === 'Received:') {
                    date = $(el).text().trim();
                    date = date.replace(/\s*\(\d+\s*sec\.\)\s*$/, '').trim();
                    const createdIdx = date.indexOf('Created:');
                    if (createdIdx >= 0) {
                        date = date.substring(0, createdIdx).trim();
                    }
                }
            });

            // Return flat format (giống các source khác) để server.js đọc đúng
            return {
                success: true,
                content: body,
                content_raw: body,
                html: body,
                subject: subject || 'Không có tiêu đề',
                from: from,
                to: to,
                date: date || null,
                hasAttm: 0
            };
        } catch (error) {
            console.error('[GeneratorEmail] Error getting message detail:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Bắt đầu theo dõi email mới qua WebSocket (Socket.IO)
     * Tùy chọn - có thể dùng polling thay thế
     */
    async watchForEmails(callback) {
        if (this.isWatching) return;
        if (!this.currentEmail) return;

        try {
            // Dynamic import socket.io-client
            const { io } = await import('socket.io-client');

            const channel = this.currentEmail.toLowerCase();

            this.socketClient = io(this.wsURL, {
                path: '/socket.io',
                transports: ['websocket'],
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000
            });

            this.socketClient.on('connect', () => {
                console.log('[GeneratorEmail] WebSocket connected');
                this.socketClient.emit('watch_for_my_email', channel);
            });

            this.socketClient.on('new_email', (data) => {
                console.log('[GeneratorEmail] New email received via WebSocket');
                try {
                    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
                    if (callback && typeof callback === 'function') {
                        callback(parsed);
                    }
                } catch (e) {
                    console.error('[GeneratorEmail] Error parsing WebSocket data:', e.message);
                }
            });

            this.socketClient.on('reconnect', () => {
                console.log('[GeneratorEmail] WebSocket reconnected');
                this.socketClient.emit('watch_for_my_email', channel);
            });

            this.socketClient.on('disconnect', () => {
                console.log('[GeneratorEmail] WebSocket disconnected');
            });

            this.isWatching = true;
        } catch (error) {
            console.error('[GeneratorEmail] Error starting WebSocket watcher:', error.message);
            // Socket.IO không khả dụng, fallback to polling
            this.isWatching = false;
        }
    }

    /**
     * Dừng theo dõi WebSocket
     */
    stopWatching() {
        if (this.socketClient) {
            try {
                if (this.currentEmail) {
                    this.socketClient.emit('dont_watch', this.currentEmail.toLowerCase());
                }
                this.socketClient.disconnect();
            } catch (e) {
                // Ignore
            }
            this.socketClient = null;
        }
        this.isWatching = false;
    }

    /**
     * Calculate date difference
     */
    calculateDateDiff(dateString) {
        if (!dateString) return '';
        try {
            const date = new Date(dateString + ' UTC');
            const now = new Date();
            const diff = now - date;

            if (diff < 60000) return 'Vừa xong';
            if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)} giờ trước`;
            return `${Math.floor(diff / 86400000)} ngày trước`;
        } catch (e) {
            return '';
        }
    }

    /**
     * Set current email (dùng khi sync)
     */
    setCurrentEmail(email) {
        this.currentEmail = email;
        if (email) {
            const [username, domain] = email.split('@');
            this.currentUsername = username;
            this.currentDomain = domain;
            // Set surl cookie cho fetchMessages
            const smurl = `${domain.toLowerCase()}/${username.toLowerCase()}`;
            if (this.surlHash) {
                this.cookies['surl'] = `${smurl}/${this.surlHash}`;
            } else {
                this.cookies['surl'] = smurl;
            }
        }
    }

    /**
     * Get current email
     */
    getCurrentEmail() {
        return this.currentEmail;
    }

    /**
     * Get all emails (compatibility)
     */
    getAllEmails() {
        return this.currentEmail ? [this.currentEmail] : [];
    }
}
