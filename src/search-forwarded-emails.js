import 'dotenv/config';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

/**
 * Tìm emails đã được forward từ các PMAIL domains
 */
async function searchForwardedEmails() {
  console.log('========== TÌM EMAILS FORWARDED ==========\n');

  const domains = [
    'mmocoffee.io.vn',
    'phatdinh24.id.vn',
    'playmaker.id.vn'
  ];

  const imapConfig = {
    user: process.env.PMAIL_IMAP_USER || 'phiphi19784321@gmail.com',
    password: process.env.PMAIL_IMAP_PASSWORD || '',
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  };

  if (!imapConfig.password) {
    console.error('❌ PMAIL_IMAP_PASSWORD chưa được set!');
    process.exit(1);
  }

  console.log('Đang search emails từ các domains:', domains.join(', '));
  console.log('(Scan tất cả emails trong 24h gần nhất)\n');

  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);
    const foundEmails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Search messages trong 1 ngày gần nhất (thay vì 7 ngày)
        const searchDate = new Date();
        searchDate.setDate(searchDate.getDate() - 1); // 24 giờ gần nhất

        imap.search([['SINCE', searchDate]], (err, results) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!results || results.length === 0) {
            console.log('⚠️  Không có email nào trong 7 ngày gần nhất');
            imap.end();
            return resolve([]);
          }

          // Lấy tất cả messages
          const messagesToCheck = results;
          console.log(`Đang kiểm tra ${messagesToCheck.length} emails (24h gần nhất)...\n`);

          const fetch = imap.fetch(messagesToCheck, {
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
                const text = parsed.text || parsed.html || '';

                // Check nếu email chứa bất kỳ domain nào
                const containsDomain = domains.some(domain => 
                  subject.toLowerCase().includes(domain) ||
                  text.toLowerCase().includes(domain) ||
                  fromEmail.toLowerCase().includes(domain)
                );

                if (containsDomain) {
                  foundEmails.push({
                    seqno,
                    subject,
                    from: fromEmail,
                    date: parsed.date,
                    preview: text.substring(0, 200).replace(/\s+/g, ' ').trim()
                  });
                }

                processed++;
                if (processed === messagesToCheck.length) {
                  imap.end();
                  
                  console.log('========== KẾT QUẢ ==========\n');
                  if (foundEmails.length > 0) {
                    console.log(`✅ Tìm thấy ${foundEmails.length} email(s) có chứa domain:\n`);
                    foundEmails.forEach((email, idx) => {
                      console.log(`${idx + 1}. ${email.subject}`);
                      console.log(`   From: ${email.from}`);
                      console.log(`   Date: ${email.date}`);
                      console.log(`   Preview: ${email.preview}\n`);
                    });
                  } else {
                    console.log('❌ Không tìm thấy email nào từ các domains:');
                    domains.forEach(d => console.log(`   - ${d}`));
                    console.log('\n💡 Có thể:');
                    console.log('   1. Cloudflare Email Routing chưa được setup');
                    console.log('   2. Catch-all chưa được enable');
                    console.log('   3. Chưa có ai gửi email đến các domains này');
                  }

                  resolve(foundEmails);
                }
              }).catch(err => {
                console.error('Parse error:', err.message);
                processed++;
                if (processed === messagesToCheck.length) {
                  imap.end();
                  resolve(foundEmails);
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

searchForwardedEmails()
  .then(() => {
    console.log('\n✅ Search hoàn tất!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
