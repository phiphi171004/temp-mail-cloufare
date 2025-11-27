import { LivewireClient } from './livewire-client.js';
// import { IMailClient } from './imail-client.js'; // Disabled: iMail source removed
import { TempMailIDClient } from './tempmail-id-client.js';
import { NoopMailClient } from './noopmail-client.js';
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
      'tempmail-id': {
        name: 'TempMail ID (tempmail.id.vn)',
        client: null,
        domains: ['tempmail.id.vn', '1trick.net', 'hathitranhnhien.edu.vn', 'nghienplus.io.vn', 'tempmail.ckvn.edu.vn'], // Domains mặc định
        defaultDomain: 'tempmail.id.vn'
      },
      'noopmail': {
        name: 'NoopMail (noopmail.org)',
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
      } else if (sourceId === 'tempmail-id') {
        source.client = new TempMailIDClient();
      } else if (sourceId === 'noopmail') {
        source.client = new NoopMailClient();
      }
    }

    // Khởi tạo client
    const initialized = await source.client.initialize();
    
    if (!initialized) {
      throw new Error(`Không thể khởi tạo nguồn mail ${source.name}`);
    }

    // Load domains cho TempMail ID và NoopMail (luôn cập nhật từ client)
    if (sourceId === 'tempmail-id' || sourceId === 'noopmail') {
      const clientDomains = source.client.getDomains();
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
    return source ? source.domains : [];
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


