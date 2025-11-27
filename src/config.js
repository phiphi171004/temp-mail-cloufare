export const CONFIG = {
  BASE_URL: 'https://tmail.mmocommunity.io.vn',
  API_ENDPOINT: '/livewire/update',
  
  DOMAINS: [
    'mmocommunity.io.vn',
    'befhopcharity.io.vn',
    'ramcloud.us',
    'ramcloud.site',
    'newramcloud.org',
    'ramcloud.net',
    'ram-cloud.org',
    'newcentury-ai.xyz',
    'ramcloud.me',
    'ramcloud.store',
    'cloudsram.me',
    'voicon.edu.vn',
    'vuk.edu.vn',
    'spzoi10.edu.pl'
  ],
  
  DEFAULT_DOMAIN: 'mmocommunity.io.vn',
  
  // TempMail ID API Token
  TEMPMAIL_ID_API_TOKEN: process.env.TEMPMAIL_ID_API_TOKEN || '',
  
  // Proxy Configuration (để bypass Cloudflare khi deploy)
  USE_PROXY: process.env.USE_PROXY === 'true',
  SCRAPERAPI_KEY: process.env.SCRAPERAPI_KEY || '',
  SCRAPERAPI_URL: 'http://api.scraperapi.com',
  
  // Cloudflare Worker Proxy (ưu tiên hơn ScraperAPI)
  USE_CLOUDFLARE_WORKER: process.env.USE_CLOUDFLARE_WORKER === 'true',
  CLOUDFLARE_WORKER_URL: process.env.CLOUDFLARE_WORKER_URL || '', // Ví dụ: https://tempmail-proxy.your-subdomain.workers.dev
  
  HEADERS: {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6',
    'content-type': 'application/json',
    'dnt': '1',
    'origin': 'https://tmail.mmocommunity.io.vn',
    'priority': 'u=1, i',
    'referer': 'https://tmail.mmocommunity.io.vn/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'x-livewire': '',
    'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  }
};

