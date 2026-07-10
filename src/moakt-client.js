import axios from 'axios';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';

const sanitizeMessageHtml = (html) => sanitizeHtml(html, {
    allowedTags: [
        'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2',
        'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre',
        'span', 'strong', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
    ],
    allowedAttributes: {
        a: ['href', 'title', 'target', 'rel'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        td: ['colspan', 'rowspan'],
        th: ['colspan', 'rowspan'],
        '*': ['dir', 'lang']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
        a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' })
    }
});

/**
 * Moakt Client
 * Client kết nối với moakt.com
 * Dùng HTTP + session cookie (tm_session)
 * Flow: POST → 302 (Set-Cookie: tm_session) → GET /vi/inbox (với cookie)
 */
export class MoaktClient {
    constructor() {
        this.baseURL = 'https://moakt.com';
        this.lang = 'vi';
        this.domains = [];
        this.currentEmail = null;
        this.currentDomain = null;
        this.currentUsername = null;
        this.sessionCookie = null;
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
    }

    /**
     * HTTP GET helper với retry logic (dùng session cookie đã có)
     */
    async httpGet(url, maxRetries = 3) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const config = {
                    method: 'GET',
                    url,
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
                        'Referer': `${this.baseURL}/${this.lang}/inbox`,
                    },
                    maxRedirects: 10,
                    timeout: 15000
                };

                if (this.sessionCookie) {
                    config.headers['Cookie'] = `tm_session=${this.sessionCookie}`;
                }

                const response = await axios(config);

                // Cập nhật session cookie nếu server gửi lại
                this.saveCookiesFromResponse(response);

                return response;
            } catch (error) {
                lastError = error;
                const isRetryable = error.code === 'ECONNRESET' ||
                    error.message?.includes('socket hang up') ||
                    error.message?.includes('ETIMEDOUT');
                if (isRetryable && attempt < maxRetries) {
                    console.log(`[Moakt] Retry ${attempt}/${maxRetries}: ${error.message}`);
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    /**
     * Lưu cookie từ response headers
     */
    saveCookiesFromResponse(response) {
        const setCookies = response.headers['set-cookie'];
        if (setCookies) {
            for (const cookie of setCookies) {
                const match = cookie.match(/tm_session=([^;]+)/);
                if (match) {
                    this.sessionCookie = match[1];
                }
            }
        }
    }

    /**
     * POST form rồi xử lý 302 redirect + cookie thủ công
     * moakt.com: POST → 302 (Set-Cookie: tm_session) → GET /vi/inbox
     * axios auto-redirect KHÔNG forward cookie mới nên phải xử lý thủ công
     */
    async postAndFollowRedirect(formData) {
        // Step 1: POST with maxRedirects=0 để bắt 302
        let postResponse;
        try {
            postResponse = await axios.post(
                `${this.baseURL}/${this.lang}/inbox`,
                formData,
                {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Origin': this.baseURL,
                        'Referer': `${this.baseURL}/${this.lang}`,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        ...(this.sessionCookie ? { 'Cookie': `tm_session=${this.sessionCookie}` } : {})
                    },
                    maxRedirects: 0,
                    timeout: 15000,
                    validateStatus: (status) => status >= 200 && status < 400
                }
            );
        } catch (error) {
            // axios throws trên 302 khi maxRedirects=0
            if (error.response && (error.response.status === 302 || error.response.status === 301)) {
                postResponse = error.response;
            } else {
                throw error;
            }
        }

        // Step 2: Lấy tm_session cookie từ 302 response
        this.saveCookiesFromResponse(postResponse);

        if (this.sessionCookie) {
            console.log('[Moakt] Session established');
        } else {
            console.warn('[Moakt] No session cookie from POST');
            return { success: false, error: 'Không nhận được session cookie' };
        }

        // Step 3: GET /vi/inbox với cookie mới để lấy email
        const inboxResponse = await this.httpGet(`${this.baseURL}/${this.lang}/inbox`);
        return this.parseInboxForEmail(inboxResponse.data);
    }

    /**
     * Khởi tạo client - fetch homepage để lấy domains
     */
    async initialize() {
        try {
            const response = await this.httpGet(this.baseURL);
            const $ = cheerio.load(response.data);

            // Parse domains từ dropdown
            const parsedDomains = [];
            $('#domains option').each((i, el) => {
                const domain = $(el).attr('value');
                if (domain && domain.includes('.')) {
                    parsedDomains.push(domain);
                }
            });

            if (parsedDomains.length > 0) {
                this.domains = parsedDomains;
            }

            // Fallback domains
            if (this.domains.length === 0) {
                this.domains = [
                    'teml.net', 'tmpeml.com', 'tmpbox.net', 'moakt.cc',
                    'disbox.net', 'tmpmail.org', 'tmpmail.net', 'tmails.net',
                    'disbox.org', 'moakt.co', 'moakt.ws', 'tmail.ws', 'bareed.ws'
                ];
            }

            console.log(`[Moakt] Initialized with ${this.domains.length} domains`);
            return true;
        } catch (error) {
            console.error('[Moakt] Error initializing:', error.message);
            this.domains = [
                'teml.net', 'tmpeml.com', 'tmpbox.net', 'moakt.cc',
                'disbox.net', 'tmpmail.org', 'tmpmail.net', 'tmails.net'
            ];
            return true;
        }
    }

    /**
     * Lấy danh sách domains
     */
    getDomains() {
        return this.domains;
    }

    /**
     * Generate random username
     */
    generateRandomUsername(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = chars.charAt(Math.floor(Math.random() * 26));
        for (let i = 1; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * Tạo email random
     */
    async createRandomEmail() {
        try {
            const formData = `random=${encodeURIComponent('Nhận một email ngẫu nhiên')}&preferred_domain=`;
            return await this.postAndFollowRedirect(formData);
        } catch (error) {
            console.error('[Moakt] Error creating random email:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Tạo email với username và domain cụ thể
     */
    async createEmail(username, domain = null) {
        try {
            if (!username) {
                username = this.generateRandomUsername();
            }
            username = username.replace(/[^a-zA-Z0-9_.+-]/g, '').toLowerCase();

            const selectedDomain = domain && this.domains.includes(domain)
                ? domain
                : (this.currentDomain || (this.domains.length > 0 ? this.domains[0] : 'teml.net'));

            const formData = `domain=${encodeURIComponent(selectedDomain)}&username=${encodeURIComponent(username)}&setemail=${encodeURIComponent('Tạo mới')}&preferred_domain=`;

            const result = await this.postAndFollowRedirect(formData);
            if (result.success) return result;
            return result;
        } catch (error) {
            console.error('[Moakt] Error creating email:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Parse inbox page để lấy email address
     */
    parseInboxForEmail(html) {
        const $ = cheerio.load(html);
        const emailAddress = $('#email-address').text().trim();

        if (emailAddress && emailAddress.includes('@')) {
            const [username, domain] = emailAddress.split('@');
            this.currentEmail = emailAddress;
            this.currentDomain = domain;
            this.currentUsername = username;

            return {
                success: true,
                email: emailAddress,
                username: username,
                domain: domain
            };
        }

        return { success: false, error: 'Không thể lấy email từ response' };
    }

    /**
     * Fetch messages từ inbox
     */
    async fetchMessages() {
        try {
            if (!this.currentEmail) {
                return { success: true, messages: [], count: 0 };
            }

            if (!this.sessionCookie) {
                return {
                    success: false,
                    error: 'Phiên Moakt đã hết hạn. Vui lòng tạo email mới.',
                    sessionExpired: true,
                    messages: [],
                    count: 0
                };
            }

            const response = await this.httpGet(`${this.baseURL}/${this.lang}/inbox`);
            const finalResponseUrl = response?.request?.res?.responseUrl;
            if (typeof finalResponseUrl === 'string') {
                try {
                    const finalPath = new URL(finalResponseUrl).pathname.replace(/\/$/, '');
                    if (finalPath !== `/${this.lang}/inbox`) {
                        return {
                            success: false,
                            error: 'Phiên Moakt đã hết hạn. Vui lòng tạo email mới.',
                            sessionExpired: true,
                            messages: [],
                            count: 0
                        };
                    }
                } catch {
                    // Continue with structural validation when Axios has no valid final URL.
                }
            }

            const $ = cheerio.load(response.data);
            const messages = [];

            const inboxEmail = $('#email-address').text().trim();
            const hasInboxTable = $('.email-messages > .tm-table').length > 0;
            if (!hasInboxTable) {
                return {
                    success: false,
                    error: 'Phản hồi từ Moakt không đúng định dạng dự kiến.',
                    upstreamUnexpected: true,
                    messages: [],
                    count: 0
                };
            }

            if (inboxEmail && inboxEmail.toLowerCase() !== this.currentEmail.toLowerCase()) {
                return {
                    success: false,
                    error: 'Phiên Moakt đã hết hạn hoặc không còn khớp với email hiện tại.',
                    sessionExpired: true,
                    messages: [],
                    count: 0
                };
            }

            // Moakt also includes an empty `.tm-table` inside #no-msg-table.
            // Scope parsing to the live inbox table so template rows are ignored.
            $('.email-messages > .tm-table tr').each((i, el) => {
                const $row = $(el);
                const link = $row.find('td:first-child a[href*="/email/"]').first();
                const href = link.attr('href') || '';
                const uuidMatch = href.match(/\/email\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/i);

                // Header, counter and empty-state rows have no message UUID.
                if (!uuidMatch) return;

                const messageId = uuidMatch[1];
                const subject = link.text().trim();
                const senderElement = $row.find('#email-sender').first();
                const sender = senderElement.text().trim();
                const senderOnclick = senderElement.find('[onclick]').attr('onclick') || '';
                const senderEmailMatch = senderOnclick.match(/show_sender_email\s*\(\s*this\s*,\s*['"]([^'"]+)['"]\s*\)/i);
                const senderEmail = senderEmailMatch ? senderEmailMatch[1].trim() : sender;

                messages.push({
                    id: messageId,
                    m_id: messageId,
                    subject: subject || 'Không có tiêu đề',
                    sender_name: sender,
                    sender_email: senderEmail,
                    to: this.currentEmail,
                    date: null,
                    datediff: '',
                    timestamp: null,
                    content: '',
                    content_raw: '',
                    hasAttm: 0,
                    attachments: []
                });
            });

            if (messages.length === 0) {
                const bodyText = $.text();
                if (bodyText.includes('Không có tin nhắn')) {
                    return { success: true, messages: [], count: 0 };
                }
            }

            return {
                success: true,
                messages: messages,
                count: messages.length
            };
        } catch (error) {
            console.error('[Moakt] Error fetching messages:', error.message);
            return { success: false, error: error.message, messages: [], count: 0 };
        }
    }

    /**
     * Lấy chi tiết message (content đầy đủ)
     */
    async getMessageDetail(messageId) {
        try {
            if (!this.sessionCookie) {
                return { success: false, error: 'Chưa có session' };
            }

            const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
            if (typeof messageId !== 'string' || !uuidPattern.test(messageId)) {
                return { success: false, error: 'Message ID không hợp lệ' };
            }

            // Current Moakt pages embed the message body in the detail HTML.
            const detailUrl = `${this.baseURL}/${this.lang}/email/${messageId}`;
            let content = '';
            let subject = '';
            let from = '';
            let date = '';

            try {
                const detailResponse = await this.httpGet(detailUrl);
                const $ = cheerio.load(detailResponse.data);

                subject = $('.message-details .title').text().trim();
                from = $('.message-details .sender span').text().trim();
                date = $('.message-details .date span').text().trim();

                const embeddedBody = $('.message-content .email-body').first();
                content = embeddedBody.length > 0
                    ? sanitizeMessageHtml(embeddedBody.html() || '')
                    : '';
            } catch (e) {
                console.warn('[Moakt] Error fetching detail page:', e.message);
            }

            // Backward compatibility for the previous Moakt content endpoint.
            if (!content) {
                const legacyContentUrl = `${this.baseURL}/${this.lang}/email/${messageId}/content/`;
                try {
                    const contentResponse = await this.httpGet(legacyContentUrl);
                    content = sanitizeMessageHtml(contentResponse.data || '');
                } catch (e) {
                    console.warn('[Moakt] Error fetching legacy content page:', e.message);
                }
            }

            if (!content && !subject && !from && !date) {
                return { success: false, error: 'Không thể tải nội dung thư từ Moakt' };
            }

            // Return flat format
            return {
                success: true,
                content: content,
                content_raw: content,
                html: content,
                subject: subject || 'Không có tiêu đề',
                from: from,
                to: this.currentEmail || '',
                date: date || null,
                hasAttm: 0
            };
        } catch (error) {
            console.error('[Moakt] Error getting message detail:', error.message);
            return { success: false, error: error.message };
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
        }
    }

    /**
     * Get current email
     */
    getCurrentEmail() {
        return this.currentEmail;
    }

    /**
     * Get all emails
     */
    getAllEmails() {
        return this.currentEmail ? [this.currentEmail] : [];
    }
}
