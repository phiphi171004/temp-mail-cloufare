import 'dotenv/config';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

/**
 * Monitor Gmail inbox real-time cho PMAIL emails
 * Auto-refresh mỗi 5 giây
 */
const domains = [
  'playmaker.id.vn',
  'mmocoffee.io.vn',
  'phatdinh24.id.vn',
  'pphimchill.app',
  'mailp.tech'
];

const imapConfig = {
  user: process.env.PMAIL_IMAP_USER || 'phiphi19784321@gmail.com',
  password: process.env.PMAIL_IMAP_PASSWORD || '',
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
  connTimeout: 10000,
  authTimeout: 5000
};

let lastCheckTime = Date.now();
let foundCount = 0;

console.log('========== PMAIL MONITOR ==========\n');
console.log('Monitoring domains:', domains.join(', '));
console.log('Target inbox:', imapConfig.user);
console.log('Checking every 5 seconds...\n');
console.log('Press Ctrl+C to stop\n');
console.log('-----------------------------------\n');

async function checkForNewEmails() {
  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);
    const newEmails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Tìm emails mới (trong 1 phút gần nhất)
        const searchDate = new Date(Date.now() - 60000); // 1 phút trước

        imap.search([['SINCE', searchDate]], (err, results) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          const fetch = imap.fetch(results, {
            bodies: '',
            struct: true
          });

          let processed = 0;

          fetch.on('message', (msg, seqno) => {
            let buffer = '';

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });

            msg.once('end', () => {
              simpleParser(buffer).then(parsed => {
                const subject = parsed.subject || '';
                const fromEmail = parsed.from?.value?.[0]?.address || '';
                const text = (parsed.text || parsed.html || '').toLowerCase();
                const date = parsed.date;

                // Check nếu email từ domain PMAIL
                const matchedDomain = domains.find(domain =>
                  subject.toLowerCase().includes(domain) ||
                  text.includes(domain) ||
                  fromEmail.toLowerCase().includes(domain)
                );

                if (matchedDomain && date && date.getTime() > lastCheckTime) {
                  newEmails.push({
                    subject,
                    from: fromEmail,
                    date,
                    domain: matchedDomain,
                    preview: text.substring(0, 150).replace(/\s+/g, ' ').trim()
                  });
                }

                processed++;
                if (processed === results.length) {
                  imap.end();
                  resolve(newEmails);
                }
              }).catch(err => {
                processed++;
                if (processed === results.length) {
                  imap.end();
                  resolve(newEmails);
                }
              });
            });
          });

          fetch.once('error', (err) => {
            imap.end();
            reject(err);
          });
        });
      });
    });

    imap.once('error', (err) => {
      reject(err);
    });

    imap.connect();
  });
}

async function monitor() {
  try {
    const newEmails = await checkForNewEmails();

    if (newEmails.length > 0) {
      foundCount += newEmails.length;
      console.log(`\n🎉 [${new Date().toLocaleTimeString()}] Tìm thấy ${newEmails.length} email mới!\n`);
      
      newEmails.forEach((email, idx) => {
        console.log(`${foundCount - newEmails.length + idx + 1}. ${email.subject}`);
        console.log(`   Domain: ${email.domain}`);
        console.log(`   From: ${email.from}`);
        console.log(`   Date: ${email.date.toLocaleString()}`);
        console.log(`   Preview: ${email.preview}\n`);
      });

      lastCheckTime = Date.now();
    } else {
      process.stdout.write(`[${new Date().toLocaleTimeString()}] Checking... No new emails\r`);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

// Check immediately
monitor();

// Then check every 5 seconds
setInterval(monitor, 5000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n✅ Monitoring stopped');
  console.log(`Total emails found: ${foundCount}`);
  process.exit(0);
});
