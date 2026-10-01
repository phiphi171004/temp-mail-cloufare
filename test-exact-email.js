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

const targetEmail = 'test933932@playmaker.id.vn';

console.log('========== TÌM EMAIL CHÍNH XÁC ==========\n');
console.log('Target:', targetEmail);
console.log('Searching in last 10 minutes...\n');

const imap = new Imap(imapConfig);

imap.once('ready', () => {
  imap.openBox('INBOX', true, (err, box) => {
    if (err) throw err;

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    imap.search([['SINCE', tenMinutesAgo]], (err, results) => {
      if (err) throw err;

      if (!results || results.length === 0) {
        console.log('❌ Không có email nào trong 10 phút');
        imap.end();
        return;
      }

      console.log(`Checking ${results.length} emails...\n`);

      const fetch = imap.fetch(results, {
        bodies: '',
        struct: true
      });

      let processed = 0;
      let found = false;

      fetch.on('message', (msg, seqno) => {
        let buffer = '';

        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });
        });

        msg.once('end', () => {
          simpleParser(buffer).then(parsed => {
            const toAddresses = [
              ...(parsed.to?.value || []),
              ...(parsed.cc?.value || []),
              ...(parsed.bcc?.value || [])
            ].map(addr => addr.address?.toLowerCase() || '');

            const subject = (parsed.subject || '').toLowerCase();
            const text = (parsed.text || '').toLowerCase();
            const html = (parsed.html || '').toLowerCase();

            // Check if target email in To field
            const matchedTo = toAddresses.some(addr => 
              addr === targetEmail.toLowerCase()
            );

            // Check if target in body
            const matchedBody = 
              text.includes(targetEmail.toLowerCase()) ||
              html.includes(targetEmail.toLowerCase()) ||
              subject.includes(targetEmail.toLowerCase());

            if (matchedTo || matchedBody) {
              found = true;
              console.log('✅ TÌM THẤY EMAIL!\n');
              console.log('Subject:', parsed.subject);
              console.log('From:', parsed.from?.text || '');
              console.log('To:', toAddresses.join(', '));
              console.log('Date:', parsed.date);
              console.log('Text preview:', (parsed.text || '').substring(0, 200));
              console.log('');
            }

            processed++;
            if (processed === results.length) {
              if (!found) {
                console.log('❌ KHÔNG TÌM THẤY email:', targetEmail);
                console.log('\n💡 Debug: Checked', processed, 'emails');
              }
              imap.end();
            }
          }).catch(() => {
            processed++;
            if (processed === results.length) imap.end();
          });
        });
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
