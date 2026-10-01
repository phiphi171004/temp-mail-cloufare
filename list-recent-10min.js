import 'dotenv/config';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

const imapConfig = {
  user: process.env.PMAIL_IMAP_USER || 'phiphi19784321@gmail.com',
  password: process.env.PMAIL_IMAP_PASSWORD || '',
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false }
};

console.log('========== EMAILS 10 PHÚT GẦN ĐÂY ==========\n');

const imap = new Imap(imapConfig);

imap.once('ready', () => {
  imap.openBox('INBOX', true, (err, box) => {
    if (err) throw err;

    // Search emails từ 10 phút trước
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    imap.search([['SINCE', tenMinutesAgo]], (err, results) => {
      if (err) throw err;

      if (!results || results.length === 0) {
        console.log('⚠️  Không có email nào trong 10 phút gần đây');
        imap.end();
        return;
      }

      console.log(`📧 Tìm thấy ${results.length} email(s)\n`);

      const fetch = imap.fetch(results, {
        bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
        struct: true
      });

      let count = 0;

      fetch.on('message', (msg, seqno) => {
        msg.on('body', (stream) => {
          let buffer = '';
          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });
          stream.on('end', () => {
            const lines = buffer.split('\r\n');
            const headers = {};
            lines.forEach(line => {
              const match = line.match(/^(.*?):\s*(.*)$/);
              if (match) {
                headers[match[1].toLowerCase()] = match[2];
              }
            });

            count++;
            console.log(`${count}. Subject: ${headers.subject || '(no subject)'}`);
            console.log(`   From: ${headers.from || 'unknown'}`);
            console.log(`   To: ${headers.to || 'unknown'}`);
            console.log(`   Date: ${headers.date || 'unknown'}\n`);
          });
        });
      });

      fetch.once('end', () => {
        console.log('✅ Hoàn tất!');
        imap.end();
      });

      fetch.once('error', (err) => {
        console.error('❌ Error:', err);
        imap.end();
      });
    });
  });
});

imap.once('error', (err) => {
  console.error('❌ IMAP Error:', err.message);
});

imap.once('end', () => {
  process.exit(0);
});

imap.connect();
