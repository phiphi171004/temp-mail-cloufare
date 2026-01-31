import axios from 'axios';

/**
 * TinyHost Temp Mail Client
 * API Docs: https://tinyhost.shop/api/docs
 */
export class TinyHostClient {
    constructor() {
        this.baseURL = 'https://tinyhost.shop';
        this.currentEmail = null;
        this.currentDomain = null;
        this.currentUser = null;
        this.domains = [];
    }

    /**
     * Initialize client - Load domains
     */
    async initialize() {
        try {
            // Load domains từ API
            this.domains = await this.getRandomDomains(20);
            return true;
        } catch (error) {
            console.error('[TinyHost] Initialize error:', error.message);
            return false;
        }
    }

    /**
     * Get domains list
     */
    getDomains() {
        return this.domains;
    }

    /**
     * Lấy danh sách domain ngẫu nhiên
     */
    async getRandomDomains(limit = 20) {
        try {
            const response = await axios.get(`${this.baseURL}/api/random-domains/`, {
                params: { limit },
                timeout: 10000 // 10 seconds timeout
            });
            return response.data.domains || [];
        } catch (error) {
            console.error('[TinyHost] Error getting domains:', error.message);
            return [];
        }
    }

    /**
     * Lấy tất cả domain
     */
    async getAllDomains() {
        try {
            const response = await axios.get(`${this.baseURL}/api/all-domains/`);
            return response.data.domains || [];
        } catch (error) {
            console.error('[TinyHost] Error getting all domains:', error.message);
            return [];
        }
    }

    /**
     * Kiểm tra MX record của domain
     */
    async checkDomain(domain) {
        try {
            const response = await axios.get(`${this.baseURL}/api/check-mx/${domain}`);
            return response.data.result === 'online';
        } catch (error) {
            console.error('[TinyHost] Error checking domain:', error.message);
            return false;
        }
    }

    /**
     * Thêm domain mới
     */
    async addDomain(domain) {
        try {
            const response = await axios.post(`${this.baseURL}/api/add-domain/${domain}`);
            return response.data;
        } catch (error) {
            console.error('[TinyHost] Error adding domain:', error.message);
            return null;
        }
    }

    /**
     * Tạo email mới
     */
    async createEmail(username, domain) {
        try {
            // TinyHost không cần tạo email trước, chỉ cần format đúng
            const email = `${username}@${domain}`;
            this.currentEmail = email;
            this.currentUser = username;
            this.currentDomain = domain;

            console.log('[TinyHost] Email created:', email);

            return {
                success: true,
                email: email,
                domain: domain
            };
        } catch (error) {
            console.error('[TinyHost] Error creating email:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Tạo email ngẫu nhiên
     */
    async createRandomEmail() {
        try {
            // Lấy domain ngẫu nhiên
            const domains = await this.getRandomDomains(1);
            if (!domains || domains.length === 0) {
                throw new Error('No domains available');
            }

            const domain = domains[0];

            // Tạo username ngẫu nhiên
            const username = this.generateRandomUsername();

            return await this.createEmail(username, domain);
        } catch (error) {
            console.error('[TinyHost] Error creating random email:', error.message);
            throw error;
        }
    }

    /**
     * Generate random username
     */
    generateRandomUsername(length = 12) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let username = '';
        for (let i = 0; i < length; i++) {
            username += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return username;
    }

    /**
     * Lấy danh sách email
     */
    async fetchMessages(page = 1, limit = 20) {
        if (!this.currentEmail || !this.currentUser || !this.currentDomain) {
            console.log('[TinyHost] No current email set');
            return [];
        }

        try {
            const response = await axios.get(
                `${this.baseURL}/api/email/${this.currentDomain}/${this.currentUser}/`,
                {
                    params: { page, limit }
                }
            );

            const emails = response.data.emails || [];

            // Format messages để đồng nhất với các nguồn khác
            return emails.map(email => ({
                id: email.id.toString(),
                subject: email.subject || 'Không có tiêu đề',
                sender_name: this.extractSenderName(email.sender),
                sender_email: email.sender || '',
                date: email.date,
                datediff: null, // Để tempmail.js tính
                timestamp: new Date(email.date).getTime(),
                content: email.html_body || email.body || 'Không có nội dung',
                content_raw: email.body || '',
                attachments: email.has_attachments ? [] : [] // TinyHost API không trả về chi tiết attachments
            }));
        } catch (error) {
            if (error.response?.status === 404) {
                console.log('[TinyHost] No messages found (404)');
                return [];
            }
            console.error('[TinyHost] Error fetching messages:', error.message);
            return [];
        }
    }

    /**
     * Lấy chi tiết một email
     */
    async getEmailDetail(emailId) {
        if (!this.currentUser || !this.currentDomain) {
            throw new Error('No current email set');
        }

        try {
            const response = await axios.get(
                `${this.baseURL}/api/email/${this.currentDomain}/${this.currentUser}/${emailId}`
            );

            const email = response.data;

            return {
                id: email.id.toString(),
                subject: email.subject || 'Không có tiêu đề',
                sender_name: this.extractSenderName(email.sender),
                sender_email: email.sender || '',
                date: email.date,
                datediff: this.calculateDateDiff(new Date(email.date)),
                timestamp: new Date(email.date).getTime(),
                content: email.html_body || email.body || 'Không có nội dung',
                content_raw: email.body || '',
                attachments: []
            };
        } catch (error) {
            console.error('[TinyHost] Error getting email detail:', error.message);
            throw error;
        }
    }

    /**
     * Xóa một email
     */
    async deleteEmail(emailId) {
        if (!this.currentUser || !this.currentDomain) {
            throw new Error('No current email set');
        }

        try {
            await axios.delete(
                `${this.baseURL}/api/email/${this.currentDomain}/${this.currentUser}/${emailId}`
            );
            return true;
        } catch (error) {
            console.error('[TinyHost] Error deleting email:', error.message);
            return false;
        }
    }

    /**
     * Set current email
     */
    setCurrentEmail(email) {
        this.currentEmail = email;

        // Parse email để lấy user và domain
        const parts = email.split('@');
        if (parts.length === 2) {
            this.currentUser = parts[0];
            this.currentDomain = parts[1];
        }
    }

    /**
     * Get current email
     */
    getCurrentEmail() {
        return this.currentEmail;
    }

    /**
     * Extract sender name from email
     */
    extractSenderName(sender) {
        if (!sender) return 'Không rõ';

        // Format: "Name <email@domain.com>" hoặc "email@domain.com"
        const match = sender.match(/^(.+?)\s*<.+>$/);
        if (match) {
            return match[1].trim();
        }

        // Nếu chỉ có email, lấy phần trước @
        const emailMatch = sender.match(/^([^@]+)@/);
        if (emailMatch) {
            return emailMatch[1];
        }

        return sender;
    }

    /**
     * Calculate date difference
     */
    calculateDateDiff(date) {
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days} ngày trước`;
        if (hours > 0) return `${hours} giờ trước`;
        if (minutes > 0) return `${minutes} phút trước`;
        return 'Vừa xong';
    }
}
