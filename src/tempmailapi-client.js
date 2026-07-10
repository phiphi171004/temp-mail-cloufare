import axios from 'axios';

/**
 * TempMailAPI Client — dùng public_api.php với API Key
 * API Key lấy từ .env: TEMPMAILAPI_KEY
 */
class TempMailApiClient {
    constructor() {
        this.baseURL = 'https://tempmailapi.io.vn';
        this.apiKey = process.env.TEMPMAILAPI_KEY || '';
        this.domains = [];

        // Current email state
        this.currentEmail = null;
        this.currentUsername = null;
        this.currentDomain = null;

        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }

    /**
     * HTTP GET helper with retry
     */
    async httpGet(url, maxRetries = 3) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.get(url, {
                    headers: { 'User-Agent': this.userAgent },
                    timeout: 15000
                });
                return response;
            } catch (error) {
                lastError = error;
                const isRetryable = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']
                    .includes(error.code) || error.message?.includes('socket hang up');

                if (isRetryable && attempt < maxRetries) {
                    const delay = 1000 * Math.pow(2, attempt - 1); // Exponential backoff
                    console.log(`[TempMailAPI] Retry ${attempt}/${maxRetries}: ${error.message} (wait ${delay}ms)`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    /**
     * Initialize — fetch domains
     */
    async initialize() {
        try {
            if (!this.apiKey) {
                console.warn('[TempMailAPI] WARNING: TEMPMAILAPI_KEY not set in .env');
            }

            const response = await this.httpGet(`${this.baseURL}/public_api.php?action=domains`);
            const data = response.data;

            if (Array.isArray(data)) {
                this.domains = data;
            } else if (data && data.domains) {
                this.domains = data.domains;
            }

            console.log(`[TempMailAPI] Initialized with ${this.domains.length} domains, API Key: ${this.apiKey ? 'SET' : 'NOT SET'}`);
            return { success: true, domains: this.domains };
        } catch (error) {
            console.error('[TempMailAPI] Init error:', error.message);
            this.domains = ['apponi.site'];
            return { success: true, domains: this.domains };
        }
    }

    /**
     * Get available domains
     */
    getDomains() {
        return this.domains;
    }

    /**
     * Create email
     * GET /public_api.php?action=create&domain=X&user=Y&api_key=KEY
     */
    async createEmail(username, domain) {
        try {
            const selectedDomain = domain || this.domains[0] || 'apponi.site';
            let url = `${this.baseURL}/public_api.php?action=create&domain=${encodeURIComponent(selectedDomain)}`;

            if (username) {
                url += `&user=${encodeURIComponent(username.toLowerCase())}`;
            }

            if (this.apiKey) {
                url += `&api_key=${encodeURIComponent(this.apiKey)}`;
            }

            const response = await this.httpGet(url);
            const data = response.data;

            // API có thể trả email ở data.email (string) hoặc data.email (object)
            const emailAddr = typeof data.email === 'string' ? data.email :
                (data.address || (username ? `${username}@${selectedDomain}` : null));

            if (emailAddr) {
                this.currentEmail = emailAddr;
                const [user, dom] = emailAddr.split('@');
                this.currentUsername = user;
                this.currentDomain = dom;

                console.log(`[TempMailAPI] Created: ${this.currentEmail}`);

                return {
                    success: true,
                    email: this.currentEmail,
                    source: 'tempmailapi'
                };
            }

            return {
                success: false,
                error: data?.error || data?.message || 'Không thể tạo email'
            };
        } catch (error) {
            // Bắt response body từ 500 error
            const errData = error.response?.data;
            const errMsg = errData?.error || errData?.message || error.message;
            console.error('[TempMailAPI] Create error:', errMsg, errData ? JSON.stringify(errData) : '');
            return { success: false, error: errMsg };
        }
    }

    /**
     * Create random email
     */
    async createRandomEmail() {
        const randomDomain = this.domains[Math.floor(Math.random() * this.domains.length)] || 'apponi.site';
        return this.createEmail(null, randomDomain);
    }

    /**
     * Fetch messages
     * GET /public_api.php?action=list&email=X&limit=20&api_key=KEY
     */
    async fetchMessages() {
        try {
            if (!this.currentEmail) {
                return { success: true, messages: [], count: 0 };
            }

            let url = `${this.baseURL}/public_api.php?action=list&email=${encodeURIComponent(this.currentEmail)}&limit=20`;
            if (this.apiKey) {
                url += `&api_key=${encodeURIComponent(this.apiKey)}`;
            }

            const response = await this.httpGet(url);
            const data = response.data;

            if (!data || data.error) {
                console.log(`[TempMailAPI] List response error:`, data?.error || 'empty');
                return { success: true, messages: [], count: 0, error: data?.error };
            }

            // Handle array or object with emails field
            const emailList = Array.isArray(data) ? data : (data.emails || []);

            const messages = emailList.map((email, index) => ({
                id: email.id || `msg-${index}`,
                m_id: email.id || `msg-${index}`,
                subject: email.subject || 'Không có tiêu đề',
                sender_name: this.extractSenderName(email.from),
                sender_email: this.extractSenderEmail(email.from),
                to: this.currentEmail,
                date: email.date || null,
                timestamp: email.date ? new Date(email.date).getTime() : null,
                content: email.body || email.text || '',
                content_raw: email.body || email.text || '',
                isHtml: email.isHtml || false,
                hasAttm: 0,
                attachments: []
            }));

            return {
                success: true,
                messages: messages,
                count: messages.length
            };
        } catch (error) {
            console.error('[TempMailAPI] Fetch error:', error.message);
            return { success: true, error: error.message, messages: [], count: 0 };
        }
    }

    /**
     * Get message detail
     * GET /public_api.php?action=read&email=X&id=Y&api_key=KEY
     */
    async getMessageDetail(messageId) {
        try {
            if (!this.currentEmail || !messageId) {
                return { success: false, error: 'Missing email or messageId' };
            }

            let url = `${this.baseURL}/public_api.php?action=read&email=${encodeURIComponent(this.currentEmail)}&id=${encodeURIComponent(messageId)}`;
            if (this.apiKey) {
                url += `&api_key=${encodeURIComponent(this.apiKey)}`;
            }

            console.log(`[TempMailAPI] Reading message ${messageId} for ${this.currentEmail}`);
            const response = await this.httpGet(url);
            const data = response.data;
            console.log('[TempMailAPI] Read response:', JSON.stringify(data).substring(0, 200));

            if (!data || data.error) {
                return { success: false, error: data?.error || 'Không thể đọc email' };
            }

            // API trả về: { success: true, email: { id, from, subject, body_html, ... } }
            const email = data.email || data;
            const body = email.body_html || email.body || email.text || '';
            const isHtml = body.trim().startsWith('<');

            // Return flat format matching server.js expectations
            return {
                success: true,
                content: body,
                content_raw: email.text || email.body_text || body,
                html: isHtml ? body : null,
                subject: email.subject || '',
                from: email.from || '',
                to: email.to || this.currentEmail,
                date: email.date || null,
                hasAttm: email.attachments?.length || 0
            };
        } catch (error) {
            console.error('[TempMailAPI] Read error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Set current email (sync from frontend)
     */
    setCurrentEmail(email) {
        this.currentEmail = email;
        if (email) {
            const [username, domain] = email.split('@');
            this.currentUsername = username;
            this.currentDomain = domain;
        }
    }

    // Helpers
    extractSenderName(from) {
        if (!from) return 'Unknown';
        const match = from.match(/^"?([^"<]+)"?\s*</);
        return match ? match[1].trim() : from.split('@')[0];
    }

    extractSenderEmail(from) {
        if (!from) return '';
        const match = from.match(/<([^>]+)>/);
        return match ? match[1] : from;
    }
}

export { TempMailApiClient };
