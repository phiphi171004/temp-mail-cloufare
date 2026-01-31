import { LivewireClient } from './livewire-client.js';
// import { IMailClient } from './imail-client.js'; // Disabled: iMail source removed
import { NoopMailClient } from './noopmail-client.js';
import { TemporaryMailClient } from './temporarymail-client.js';
import { MailIOClient } from './mailio-client.js';
import { ETempMailClient } from './etempmail-client.js';
import { PriyoClient } from './priyo-client.js';
import { PMailClient } from './pmail-client.js';
import { TinyHostClient } from './tinyhost-client.js';
import { EduMailClient } from './edumail-client.js';
import { AppleClient } from './apple-client.js';
import { CONFIG } from './config.js';

/**
 * Mail Source Manager
 * Quản lý nhiều nguồn mail khác nhau
 */
export class MailSourceManager {
  constructor() {
    this.sources = {
      'tmail': {
        name: 'TempMail (mmocommunity.io.vn)',
        client: null,
        domains: CONFIG.DOMAINS,
        defaultDomain: CONFIG.DEFAULT_DOMAIN
      },
      // 'imail': { // Disabled: iMail source removed due to instability
      //   name: 'iMail (imail.edu.vn)',
      //   client: null,
      //   domains: [], // Sẽ được load từ API
      //   defaultDomain: null
      // },
      'noopmail': {
        name: 'NoopMail (noopmail.org)',
        client: null,
        domains: [], // Sẽ được load từ API
        defaultDomain: null
      },
      'temporarymail': {
        name: 'TemporaryMail (temporarymail.com)',
        client: null,
        domains: [], // Sẽ được load từ API
        defaultDomain: null
      },
      'mailio': {
        name: 'MailIO (temp-mail.io)',
        client: null,
        domains: [], // Sẽ được load từ API
        defaultDomain: null
      },
      'etempmail': {
        name: 'eTempMail (etempmail.com)',
        client: null,
        domains: ['ohm.edu.pl', 'cross.edu.pl', 'usa.edu.pl', 'beta.edu.pl'], // Domains mặc định
        defaultDomain: 'ohm.edu.pl'
      },
      'priyo': {
        name: 'Priyo (priyo.email)',
        client: null,
        domains: [], // Sẽ được load từ client
        defaultDomain: null
      },
      'pmail': {
        name: 'PMAIL (Mail Forward)',
        client: null,
        domains: ['shopsheap.online', 'mmocoffee.io.vn', 'phatdinh24.id.vn', 'playmaker.id.vn', 'shopaccsheap.pro.vn'],
        defaultDomain: 'shopsheap.online'
      },
      'tinyhost': {
        name: 'TinyHost (tinyhost.shop)',
        client: null,
        domains: [], // Sẽ được load từ API
        defaultDomain: null
      },
      'edumail': {
        name: 'EduMail (edumailfree.com)',
        client: null,
        domains: [], // Sẽ được load từ client
        defaultDomain: null
      },
      'apple': {
        name: 'Apple.edu (apple.edu.pl)',
        client: null,
        domains: [], // Sẽ được load từ API
        defaultDomain: null
      }
    };

    this.currentSource = 'tmail'; // Default source
  }

  /**
   * Khởi tạo nguồn mail
   */
  async initSource(sourceId = 'tmail') {
    if (!this.sources[sourceId]) {
      throw new Error(`Nguồn mail ${sourceId} không tồn tại`);
    }

    const source = this.sources[sourceId];

    // Khởi tạo client nếu chưa có
    if (!source.client) {
      if (sourceId === 'tmail') {
        source.client = new LivewireClient();
      } else if (sourceId === 'imail') {
        throw new Error('iMail source đã bị vô hiệu hóa do không ổn định');
      } else if (sourceId === 'noopmail') {
        source.client = new NoopMailClient();
      } else if (sourceId === 'temporarymail') {
        source.client = new TemporaryMailClient();
      } else if (sourceId === 'mailio') {
        source.client = new MailIOClient();
      } else if (sourceId === 'etempmail') {
        source.client = new ETempMailClient();
      } else if (sourceId === 'priyo') {
        source.client = new PriyoClient();
      } else if (sourceId === 'pmail') {
        source.client = new PMailClient();
      } else if (sourceId === 'tinyhost') {
        source.client = new TinyHostClient();
      } else if (sourceId === 'edumail') {
        source.client = new EduMailClient();
      } else if (sourceId === 'apple') {
        source.client = new AppleClient();
      }
    }

    // Khởi tạo client
    const initialized = await source.client.initialize();

    if (!initialized) {
      throw new Error(`Không thể khởi tạo nguồn mail ${source.name}`);
    }

    // Load domains cho NoopMail, TemporaryMail, MailIO, eTempMail, Priyo, PMAIL, TinyHost, EduMail và Apple (luôn cập nhật từ client)
    if (sourceId === 'noopmail' || sourceId === 'temporarymail' || sourceId === 'mailio' || sourceId === 'etempmail' || sourceId === 'priyo' || sourceId === 'pmail' || sourceId === 'tinyhost' || sourceId === 'edumail' || sourceId === 'apple') {
      const clientDomains = await source.client.getDomains();
      if (clientDomains && clientDomains.length > 0) {
        source.domains = clientDomains;
        if (source.domains.length > 0) {
          source.defaultDomain = source.domains[0];
        }
      }
    }

    this.currentSource = sourceId;
    return true;
  }

  /**
   * Lấy client hiện tại
   */
  getCurrentClient() {
    const source = this.sources[this.currentSource];
    if (!source || !source.client) {
      throw new Error(`Nguồn mail ${this.currentSource} chưa được khởi tạo`);
    }
    return source.client;
  }

  /**
   * Lấy danh sách domains của nguồn hiện tại
   */
  getCurrentDomains() {
    const source = this.sources[this.currentSource];
    if (!source) return [];

    // Nếu client có method getDomains(), gọi nó để lấy domains động (như priyo)
    if (source.client && typeof source.client.getDomains === 'function') {
      try {
        const domains = source.client.getDomains();
        // Cập nhật source.domains để cache
        if (Array.isArray(domains) && domains.length > 0) {
          source.domains = domains;
          return domains;
        }
      } catch (error) {
        console.error('[MailSourceManager] Error getting domains from client:', error);
      }
    }

    // Fallback: trả về domains tĩnh
    return source.domains || [];
  }

  /**
   * Lấy domain mặc định của nguồn hiện tại
   */
  getCurrentDefaultDomain() {
    const source = this.sources[this.currentSource];
    return source ? source.defaultDomain : null;
  }

  /**
   * Chuyển đổi nguồn mail
   */
  async switchSource(sourceId) {
    if (this.currentSource === sourceId) {
      return true; // Đã là nguồn hiện tại
    }

    await this.initSource(sourceId);
    return true;
  }

  /**
   * Lấy danh sách tất cả nguồn mail
   */
  getAllSources() {
    return Object.keys(this.sources).map(id => ({
      id: id,
      name: this.sources[id].name,
      domains: this.sources[id].domains.length,
      isCurrent: id === this.currentSource
    }));
  }

  /**
   * Lấy thông tin nguồn hiện tại
   */
  getCurrentSourceInfo() {
    return {
      id: this.currentSource,
      name: this.sources[this.currentSource].name,
      domains: this.sources[this.currentSource].domains,
      defaultDomain: this.sources[this.currentSource].defaultDomain
    };
  }
}


