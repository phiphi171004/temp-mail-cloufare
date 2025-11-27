/**
 * Cloudflare Worker - Reverse Proxy cho TempMail APIs
 * 
 * Cách dùng:
 * 1. Deploy Worker này lên Cloudflare
 * 2. Lấy URL Worker (ví dụ: tempmail-proxy.your-subdomain.workers.dev)
 * 3. Cập nhật CLOUDFLARE_WORKER_URL trong .env
 * 
 * Worker sẽ proxy các request:
 * - /tempmail-id/* → https://tempmail.id.vn/api/*
 * - /noopmail/* → https://noopmail.org/*
 * - /tmail/* → https://tmail.mmocommunity.io.vn/*
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    const search = url.search;
    
    // Xác định target API dựa trên path
    let targetBase = '';
    let newPath = '';
    
    // Nếu path bắt đầu bằng /tempmail-id → proxy đến tempmail.id.vn
    if (path.startsWith('/tempmail-id')) {
      targetBase = 'https://tempmail.id.vn/api';
      newPath = path.replace('/tempmail-id', '') || '/';
    }
    // Nếu path bắt đầu bằng /noopmail → proxy đến noopmail.org
    else if (path.startsWith('/noopmail')) {
      targetBase = 'https://noopmail.org';
      newPath = path.replace('/noopmail', '') || '/';
    }
    // Nếu path bắt đầu bằng /tmail → proxy đến tmail.mmocommunity.io.vn
    else if (path.startsWith('/tmail')) {
      targetBase = 'https://tmail.mmocommunity.io.vn';
      newPath = path.replace('/tmail', '') || '/';
    }
    // Default: proxy đến tempmail.id.vn
    else {
      targetBase = 'https://tempmail.id.vn/api';
      newPath = path || '/';
    }
    
    // Thêm search params nếu có
    if (search) {
      newPath += search;
    }
    
    // Tạo target URL
    const targetUrl = targetBase + newPath;
    
    // Tạo request mới với headers từ request gốc
    const newHeaders = new Headers();
    
    // Copy headers từ request gốc (trừ một số headers có thể gây vấn đề)
    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.toLowerCase();
      // Bỏ qua các headers có thể gây vấn đề, nhưng giữ lại cookies
      if (lowerKey === 'cookie') {
        // Forward cookies từ client lên server
        newHeaders.set(key, value);
      } else if (lowerKey !== 'host' && 
          lowerKey !== 'cf-connecting-ip' && 
          lowerKey !== 'cf-ray' &&
          lowerKey !== 'cf-visitor' &&
          lowerKey !== 'cf-ipcountry') {
        newHeaders.set(key, value);
      }
    }
    
    // Thêm User-Agent nếu chưa có
    if (!newHeaders.has('user-agent')) {
      newHeaders.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');
    }
    
    // Tạo request mới
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'follow'
    });
    
    try {
      // Gọi API đích
      const response = await fetch(newRequest);
      
      // Clone response để có thể đọc body
      const responseBody = await response.text();
      
      // Tạo headers mới cho response
      const responseHeaders = new Headers();
      
      // Copy tất cả headers từ response gốc (bao gồm cookies)
      for (const [key, value] of response.headers.entries()) {
        const lowerKey = key.toLowerCase();
        // Copy tất cả headers, đặc biệt là set-cookie
        if (lowerKey === 'set-cookie') {
          // Forward cookies từ server
          responseHeaders.append(key, value);
        } else if (lowerKey !== 'content-encoding' && lowerKey !== 'transfer-encoding') {
          // Copy các headers khác (trừ encoding headers)
          responseHeaders.set(key, value);
        }
      }
      
      // Thêm CORS headers
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', '*');
      responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      responseHeaders.set('Access-Control-Expose-Headers', 'Set-Cookie');
      
      // Tạo response mới với headers đầy đủ
      const newResponse = new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
      
      return newResponse;
    } catch (error) {
      // Trả về lỗi dạng JSON
      return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }
  }
};

