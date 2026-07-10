(function attachEmailRenderer(global) {
  const CSP = "default-src 'none'; img-src https: http: data: cid:; style-src 'unsafe-inline'; font-src https: http: data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

  function stripActiveContent(html) {
    return String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
      .replace(/<meta\b[^>]*name\s*=\s*["']?viewport["']?[^>]*>/gi, '')
      .replace(/<base\b[^>]*>/gi, '');
  }

  function buildIsolatedDocument(html) {
    const source = stripActiveContent(html);
    const headMatch = source.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
    const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
    const headContent = headMatch ? headMatch[1] : '';
    const bodyContent = bodyMatch
      ? bodyMatch[1]
      : source
        .replace(/<!doctype[^>]*>/gi, '')
        .replace(/<\/?html\b[^>]*>/gi, '')
        .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '');
    const content = bodyContent.trim() || '<p class="email-empty">Không có nội dung</p>';

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${CSP}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base target="_blank">
    ${headContent}
    <style>
      /* Contain email HTML so mobile/fixed templates cannot break parent page */
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        min-width: 0 !important;
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
        overflow-x: auto !important;
        overflow-wrap: anywhere !important;
        word-wrap: break-word !important;
        -webkit-text-size-adjust: 100%;
      }
      body {
        padding: 12px !important;
        box-sizing: border-box !important;
      }
      /* Scale media; allow tables to keep email column structure */
      img, video, iframe, object, embed, svg {
        max-width: 100% !important;
        height: auto !important;
      }
      table {
        max-width: 100% !important;
      }
      pre, code {
        white-space: pre-wrap !important;
        word-break: break-word !important;
        max-width: 100% !important;
      }
      .email-empty {
        color: #64748b;
        font-family: sans-serif;
        text-align: center;
        padding: 32px;
      }
    </style>
  </head>
  <body>${content}</body>
</html>`;
  }

  function fitFrameHeight(frame) {
    if (!frame) return;
    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc) return;
      const body = doc.body;
      const html = doc.documentElement;
      if (!body || !html) return;

      const height = Math.ceil(
        Math.max(
          body.scrollHeight || 0,
          body.offsetHeight || 0,
          html.scrollHeight || 0,
          html.offsetHeight || 0,
          120
        )
      );
      // Cap extreme heights; allow scroll inside iframe if needed
      const capped = Math.min(Math.max(height + 8, 140), 12000);
      frame.style.height = capped + 'px';
    } catch (_) {
      // Sandbox / cross-origin — keep CSS min-height
    }
  }

  function render(container, html) {
    if (!container || typeof document === 'undefined') return null;

    const frame = document.createElement('iframe');
    frame.className = 'email-content-frame';
    frame.title = 'Nội dung email';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer';
    // allow-same-origin: measure height for auto-resize (no allow-scripts)
    frame.setAttribute(
      'sandbox',
      'allow-same-origin allow-popups allow-popups-to-escape-sandbox'
    );
    frame.setAttribute('scrolling', 'auto');
    frame.srcdoc = buildIsolatedDocument(html);

    const onReady = () => {
      fitFrameHeight(frame);
      // Second pass after images/fonts load
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        const imgs = doc.images || [];
        let pending = 0;
        for (let i = 0; i < imgs.length; i++) {
          if (!imgs[i].complete) {
            pending++;
            imgs[i].addEventListener('load', () => fitFrameHeight(frame), { once: true });
            imgs[i].addEventListener('error', () => fitFrameHeight(frame), { once: true });
          }
        }
        if (pending === 0) {
          requestAnimationFrame(() => fitFrameHeight(frame));
        }
      } catch (_) { /* ignore */ }
    };

    frame.addEventListener('load', onReady);
    container.replaceChildren(frame);

    // Fallback if load already fired (srcdoc can be sync in some browsers)
    setTimeout(onReady, 50);
    setTimeout(() => fitFrameHeight(frame), 300);

    return frame;
  }

  global.EmailRenderer = Object.freeze({ buildIsolatedDocument, render, fitFrameHeight });
})(globalThis);
