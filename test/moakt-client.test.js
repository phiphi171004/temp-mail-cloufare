import test from 'node:test';
import assert from 'node:assert/strict';

import { MoaktClient } from '../src/moakt-client.js';

const MESSAGE_ID = '01e0e856-d1de-446e-8beb-d6db8af0b1f9';

const inboxHtml = `
  <div id="email-address">captured@tmpmail.org</div>
  <div id="email_message_list">
    <div class="email-messages modal">
      <table class="tm-table">
        <tr><th>Subject</th><th>Sender</th><th>Actions</th></tr>
        <tr>
          <td><a href="/vi/email/${MESSAGE_ID}">Your VideoGen sign up code is 168201</a></td>
          <td id="email-sender"><span onclick="show_sender_email(this, 'noreply@videogen.io')">&quot;VideoGen&quot;</span></td>
          <td><a href="/vi/email/${MESSAGE_ID}/delete">Delete</a></td>
        </tr>
        <tr><td colspan="3" class="mail_message_counter">Total: 1</td></tr>
      </table>
    </div>
    <template id="no-msg-table">
      <table class="tm-table">
        <tr><th>Subject</th><th>Sender</th><th>Actions</th></tr>
        <tr><td colspan="3">No messages</td></tr>
      </table>
    </template>
  </div>`;

const detailHtml = `
  <div class="message-container">
    <div class="message-details">
      <ul>
        <li class="title">Your VideoGen sign up code is 168201</li>
        <li class="sender"><span>&quot;VideoGen&quot; &lt;noreply@videogen.io&gt;</span></li>
        <li class="date"><span>2026-07-10 04:22:48</span></li>
      </ul>
    </div>
    <div class="message-content"><div class="email-body"><h2>Sign up for VideoGen</h2><strong>168201</strong><img src="x" onerror="alert(1)"><script>alert(1)</script></div></div>
  </div>`;

test('fetchMessages parses only real rows from the current Moakt inbox markup', async () => {
  const client = new MoaktClient();
  client.setCurrentEmail('captured@tmpmail.org');
  client.sessionCookie = 'server-side-session';
  client.httpGet = async () => ({ data: inboxHtml, headers: {} });

  const result = await client.fetchMessages();

  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.messages.map(({ id, subject, sender_name, sender_email }) => ({
    id,
    subject,
    sender_name,
    sender_email
  })), [{
    id: MESSAGE_ID,
    subject: 'Your VideoGen sign up code is 168201',
    sender_name: '"VideoGen"',
    sender_email: 'noreply@videogen.io'
  }]);
});

test('getMessageDetail reads content embedded in the current detail page', async () => {
  const client = new MoaktClient();
  client.setCurrentEmail('captured@tmpmail.org');
  client.sessionCookie = 'server-side-session';
  const requestedUrls = [];
  client.httpGet = async (url) => {
    requestedUrls.push(url);
    return { data: detailHtml, headers: {} };
  };

  const result = await client.getMessageDetail(MESSAGE_ID);

  assert.equal(result.success, true);
  assert.match(result.content, /Sign up for VideoGen/);
  assert.match(result.content, /168201/);
  assert.doesNotMatch(result.content, /onerror|<script/i);
  assert.equal(result.subject, 'Your VideoGen sign up code is 168201');
  assert.equal(result.from, '"VideoGen" <noreply@videogen.io>');
  assert.deepEqual(requestedUrls, [`https://moakt.com/vi/email/${MESSAGE_ID}`]);
});

test('fetchMessages reports an expired server-side Moakt session', async () => {
  const client = new MoaktClient();
  client.setCurrentEmail('captured@tmpmail.org');

  const result = await client.fetchMessages();

  assert.equal(result.success, false);
  assert.equal(result.sessionExpired, true);
  assert.deepEqual(result.messages, []);
});

test('getMessageDetail rejects an invalid message id before making a request', async () => {
  const client = new MoaktClient();
  client.sessionCookie = 'server-side-session';
  let requestCount = 0;
  client.httpGet = async () => {
    requestCount += 1;
    return { data: '', headers: {} };
  };

  const result = await client.getMessageDetail('../inbox');

  assert.equal(result.success, false);
  assert.equal(result.error, 'Message ID không hợp lệ');
  assert.equal(requestCount, 0);
});

test('fetchMessages rejects a stale session that points to another mailbox', async () => {
  const client = new MoaktClient();
  client.setCurrentEmail('expected@tmpmail.org');
  client.sessionCookie = 'stale-server-side-session';
  client.httpGet = async () => ({
    data: '<div id="email-address">different@tmpmail.org</div><div class="email-messages"><table class="tm-table"></table></div>',
    headers: {}
  });

  const result = await client.fetchMessages();

  assert.equal(result.success, false);
  assert.equal(result.sessionExpired, true);
  assert.deepEqual(result.messages, []);
});

test('fetchMessages treats unexpected upstream HTML as a parser error, not an expired session', async () => {
  const client = new MoaktClient();
  client.setCurrentEmail('expected@tmpmail.org');
  client.sessionCookie = 'server-side-session';
  client.httpGet = async () => ({
    data: '<html><body><h1>Temporary maintenance</h1></body></html>',
    headers: {}
  });

  const result = await client.fetchMessages();

  assert.equal(result.success, false);
  assert.equal(result.upstreamUnexpected, true);
  assert.equal(result.sessionExpired, undefined);
  assert.deepEqual(result.messages, []);
});

test('fetchMessages recognizes an upstream redirect to the logged-out page', async () => {
  const client = new MoaktClient();
  client.setCurrentEmail('expected@tmpmail.org');
  client.sessionCookie = 'expired-server-side-session';
  client.httpGet = async () => ({
    data: '<html><body>Moakt home</body></html>',
    headers: {},
    request: { res: { responseUrl: 'https://moakt.com/vi' } }
  });

  const result = await client.fetchMessages();

  assert.equal(result.success, false);
  assert.equal(result.sessionExpired, true);
  assert.deepEqual(result.messages, []);
});

test('createEmail does not report success when Moakt did not create a session', async () => {
  const client = new MoaktClient();
  client.domains = ['tmpmail.org'];
  client.postAndFollowRedirect = async () => ({ success: false, error: 'Session unavailable' });

  const result = await client.createEmail('requested', 'tmpmail.org');

  assert.deepEqual(result, { success: false, error: 'Session unavailable' });
  assert.equal(client.currentEmail, null);
});

test('getMessageDetail reports failure when current and legacy detail APIs fail', async () => {
  const client = new MoaktClient();
  client.sessionCookie = 'server-side-session';
  client.httpGet = async () => {
    throw new Error('upstream unavailable');
  };

  const result = await client.getMessageDetail(MESSAGE_ID);

  assert.equal(result.success, false);
  assert.equal(result.error, 'Không thể tải nội dung thư từ Moakt');
});
