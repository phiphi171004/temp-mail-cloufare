import test from 'node:test';
import assert from 'node:assert/strict';

await import('../src/public/email-renderer.js');

const { buildIsolatedDocument } = globalThis.EmailRenderer;

test('buildIsolatedDocument keeps mobile email CSS inside a standalone document', () => {
  const emailHtml = `
    <html>
      <head>
        <meta name="viewport" content="width=343">
        <style>.container { width: 343px } body { width: 343px }</style>
        <script>window.top.document.body.style.width = '343px'</script>
      </head>
      <body><div class="container">OTP 167312</div></body>
    </html>`;

  const result = buildIsolatedDocument(emailHtml);

  assert.match(result, /Content-Security-Policy/i);
  assert.match(result, /script-src 'none'/i);
  assert.match(result, /form-action 'none'/i);
  assert.match(result, /OTP 167312/);
  assert.match(result, /\.container \{ width: 343px \}/);
});

test('buildIsolatedDocument adds a safe base target for email links', () => {
  const result = buildIsolatedDocument('<p><a href="https://example.com">Open</a></p>');

  assert.match(result, /<base target="_blank">/i);
  assert.match(result, /<a href="https:\/\/example\.com">Open<\/a>/i);
});

test('buildIsolatedDocument handles empty and body-fragment messages', () => {
  const empty = buildIsolatedDocument('');
  const fragment = buildIsolatedDocument('<strong>Hello</strong>');

  assert.match(empty, /Không có nội dung/);
  assert.match(fragment, /<!doctype html>/i);
  assert.match(fragment, /<strong>Hello<\/strong>/i);
});
