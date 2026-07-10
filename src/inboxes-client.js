import axios from 'axios';
import crypto from 'crypto';

/**
 * Inboxes.com Client — dùng API v2
 * Không cần API key, dùng user_id cookie
 */
class InboxesClient {
    constructor() {
        this.baseURL = 'https://inboxes.com';
        this.domains = [];

        // Current email state
        this.currentEmail = null;
        this.currentUsername = null;
        this.currentDomain = null;

        // User ID cookie (UUID) — tạo mới mỗi session
        this.userId = crypto.randomUUID();

        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
    }

    /**
     * HTTP GET helper with retry
     */
    async httpGet(url, maxRetries = 3) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Cookie': `user_id=${this.userId}`,
                        'Referer': 'https://inboxes.com/',
                        'Accept': '*/*',
                    },
                    timeout: 15000
                });
                return response;
            } catch (error) {
                lastError = error;
                const isRetryable = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']
                    .includes(error.code) || error.message?.includes('socket hang up');

                if (isRetryable && attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt - 1);
                    console.log(`[Inboxes] Retry ${attempt}/${maxRetries}: ${error.message} (wait ${delay}ms)`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    /**
     * HTTP POST helper with retry (native https — avoid axios auto Content-Type)
     */
    async httpPost(url, maxRetries = 3) {
        const https = await import('https');
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await new Promise((resolve, reject) => {
                    const parsedUrl = new URL(url);
                    const options = {
                        hostname: parsedUrl.hostname,
                        port: 443,
                        path: parsedUrl.pathname,
                        method: 'POST',
                        headers: {
                            'User-Agent': this.userAgent,
                            'Cookie': `user_id=${this.userId}`,
                            'Referer': 'https://inboxes.com/',
                            'Origin': 'https://inboxes.com',
                            'Accept': '*/*',
                            'Content-Length': '0',
                        }
                    };
                    const req = https.default.request(options, (res) => {
                        let body = '';
                        // Lưu user_id cookie từ response
                        const setCookie = res.headers['set-cookie'];
                        if (setCookie) {
                            const match = setCookie.toString().match(/user_id=([^;]+)/);
                            if (match) this.userId = match[1];
                        }
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            try {
                                resolve({ data: JSON.parse(body), status: res.statusCode });
                            } catch (e) {
                                resolve({ data: body, status: res.statusCode });
                            }
                        });
                    });
                    req.on('error', reject);
                    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
                    req.end();
                });
                return result;
            } catch (error) {
                lastError = error;
                const isRetryable = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']
                    .includes(error.code) || error.message?.includes('socket hang up');

                if (isRetryable && attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt - 1);
                    console.log(`[Inboxes] Retry ${attempt}/${maxRetries}: ${error.message} (wait ${delay}ms)`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    /**
     * Initialize — lấy danh sách domains
     * GET /api/v2/domain
     */
    async initialize() {
        try {
            const response = await this.httpGet(`${this.baseURL}/api/v2/domain`);
            const data = response.data;

            // Lưu user_id cookie từ response nếu có
            const setCookie = response.headers['set-cookie'];
            if (setCookie) {
                const match = setCookie.toString().match(/user_id=([^;]+)/);
                if (match) {
                    this.userId = match[1];
                    console.log('[Inboxes] Got user_id cookie:', this.userId);
                }
            }

            if (data && data.domains && Array.isArray(data.domains)) {
                this.domains = data.domains.map(d => d.qdn);
                console.log(`[Inboxes] Initialized with ${this.domains.length} domains`);
                return true;
            }

            console.error('[Inboxes] Init: Invalid domains response');
            return false;
        } catch (error) {
            console.error('[Inboxes] Init error:', error.message);
            return false;
        }
    }

    /**
     * Get available domains
     */
    getDomains() {
        return this.domains;
    }

    /**
     * Set current email (cho sync khi reload)
     */
    setCurrentEmail(email) {
        this.currentEmail = email;
        if (email) {
            const [user, domain] = email.split('@');
            this.currentUsername = user;
            this.currentDomain = domain;
        }
    }

    /**
     * Create custom email — GET /api/v2/inbox/:username@domain
     * Inboxes.com tạo custom email bằng cách GET inbox với email cụ thể
     */
    async createEmail(username, domain) {
        try {
            const selectedDomain = domain || this.domains[0] || 'spicysoda.com';
            const emailUser = username ? username.toLowerCase() : null;

            if (!emailUser) {
                return { success: false, error: 'Username is required' };
            }

            const emailAddr = `${emailUser}@${selectedDomain}`;

            // GET /api/v2/inbox/email — tạo/mở inbox
            const response = await this.httpGet(`${this.baseURL}/api/v2/inbox/${encodeURIComponent(emailAddr)}`);

            // Response: {"msgs":[]} — inbox đã sẵn sàng
            this.currentEmail = emailAddr;
            this.currentUsername = emailUser;
            this.currentDomain = selectedDomain;

            console.log(`[Inboxes] Created custom: ${this.currentEmail}`);

            return {
                success: true,
                email: this.currentEmail,
                username: this.currentUsername,
                domain: this.currentDomain,
                source: 'inboxes'
            };
        } catch (error) {
            const errData = error.response?.data;
            const errMsg = errData?.error || errData?.message || error.message;
            console.error('[Inboxes] Create error:', errMsg);
            return { success: false, error: errMsg };
        }
    }

    /**
     * Create random email — POST /api/v2/inbox
     */
    async createRandomEmail() {
        try {
            const response = await this.httpPost(`${this.baseURL}/api/v2/inbox`);
            const data = response.data;

            if (data && data.inbox) {
                this.currentEmail = data.inbox;
                const [user, dom] = data.inbox.split('@');
                this.currentUsername = user;
                this.currentDomain = dom;

                console.log(`[Inboxes] Created random: ${this.currentEmail}`);

                return {
                    success: true,
                    email: this.currentEmail,
                    username: this.currentUsername,
                    domain: this.currentDomain,
                    source: 'inboxes'
                };
            }

            return {
                success: false,
                error: data?.error || 'Không thể tạo email'
            };
        } catch (error) {
            const errData = error.response?.data;
            const errMsg = errData?.error || errData?.message || error.message;
            console.error('[Inboxes] Create random error:', errMsg);
            return { success: false, error: errMsg };
        }
    }

    /**
     * Fetch messages — GET /api/v2/inbox/:email
     * Response fields: uid, f (from), s (subject), cr (created), ph (preview), rr (relative time)
     */
    async fetchMessages() {
        try {
            if (!this.currentEmail) {
                return { success: true, messages: [], count: 0 };
            }

            const response = await this.httpGet(`${this.baseURL}/api/v2/inbox/${encodeURIComponent(this.currentEmail)}`);
            const data = response.data;

            if (data && Array.isArray(data.msgs)) {
                const messages = data.msgs.map(msg => ({
                    id: msg.uid,
                    subject: msg.s || 'Không có tiêu đề',
                    sender: msg.f || '',
                    sender_name: msg.f || '',
                    from: msg.f || '',
                    date: msg.cr || null,
                    datediff: msg.rr || null,
                    preview: msg.ph || '',
                    content: '',  // Nội dung lấy từ getMessageDetail
                    hasAttm: msg.at?.length || 0
                }));

                return {
                    success: true,
                    messages: messages,
                    count: messages.length
                };
            }

            return { success: true, messages: [], count: 0 };
        } catch (error) {
            console.error('[Inboxes] Fetch error:', error.message);
            return {
                success: true,
                messages: [],
                count: 0,
                error: error.message
            };
        }
    }

    /**
     * Get message detail — GET /api/v2/message/:uid
     * Response: { uid, f, ff, s, html, text, cr, rr, ... }
     */
    async getMessageDetail(messageId) {
        try {
            if (!messageId) {
                return { success: false, error: 'Missing messageId' };
            }

            const response = await this.httpGet(`${this.baseURL}/api/v2/message/${encodeURIComponent(messageId)}`);
            const data = response.data;

            if (!data || data.error) {
                return { success: false, error: data?.error || 'Không thể đọc email' };
            }

            const html = data.html || data.short_html || '';
            const text = data.text || '';

            // Return flat format matching server.js expectations
            return {
                success: true,
                content: html || text,
                content_raw: text || html,
                html: html || null,
                subject: data.s || '',
                from: data.f || '',
                to: this.currentEmail || '',
                date: data.cr || null,
                hasAttm: data.at?.length || 0
            };
        } catch (error) {
            console.error('[Inboxes] Read error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

export { InboxesClient };
