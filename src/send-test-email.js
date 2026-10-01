import 'dotenv/config';
import nodemailer from 'nodemailer';

/**
 * Gửi email test để kiểm tra PMAIL
 * Email sẽ được gửi từ Gmail đến chính Gmail (để test matching logic)
 */
async function sendTestEmail() {
  console.log('========== GỬI EMAIL TEST CHO PMAIL ==========\n');

  // Tạo test email address
  const testEmail = `test${Date.now()}@mmocoffee.io.vn`;
  console.log('Target email (temp):', testEmail);

  // Gmail SMTP config (dùng app password từ .env)
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.PMAIL_IMAP_USER || 'phiphi19784321@gmail.com',
      pass: process.env.PMAIL_IMAP_PASSWORD || ''
    }
  });

  if (!process.env.PMAIL_IMAP_PASSWORD) {
    console.error('❌ ERROR: PMAIL_IMAP_PASSWORD chưa được set trong .env!');
    process.exit(1);
  }

  // Email content - Quan trọng: Phải chứa target email trong body
  const mailOptions = {
    from: process.env.PMAIL_IMAP_USER,
    to: process.env.PMAIL_IMAP_USER, // Gửi đến chính mình
    subject: `Test PMAIL - ${testEmail}`,
    html: `
      <h2>Email test cho PMAIL service</h2>
      <p>Email này được gửi để test matching logic của PMAIL.</p>
      <p><strong>Target email:</strong> ${testEmail}</p>
      <p><strong>Gửi đến:</strong> ${testEmail}</p>
      <hr>
      <p>Thời gian: ${new Date().toISOString()}</p>
    `,
    text: `
      Email test cho PMAIL service
      
      Target email: ${testEmail}
      Gửi đến: ${testEmail}
      
      Thời gian: ${new Date().toISOString()}
    `
  };

  try {
    console.log('\nĐang gửi email...');
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email đã được gửi thành công!');
    console.log('Message ID:', info.messageId);
    
    console.log('\n📝 Để test PMAIL:');
    console.log('1. Đợi 5-10 giây để email được deliver');
    console.log('2. Chạy: node src/test-pmail.js');
    console.log('3. Hoặc tạo email trong web UI với username:', testEmail.split('@')[0]);
    console.log('\n⚠️  Lưu ý: PMAIL sẽ tìm email có chứa "' + testEmail + '" trong subject hoặc body\n');
    
  } catch (error) {
    console.error('❌ Lỗi gửi email:', error.message);
    if (error.message.includes('Invalid login')) {
      console.log('\n💡 Lưu ý: Gmail yêu cầu "App Password" thay vì password thường');
      console.log('Tạo App Password tại: https://myaccount.google.com/apppasswords');
    }
  }
}

// Run
sendTestEmail();
