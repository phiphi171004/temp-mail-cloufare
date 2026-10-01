import 'dotenv/config';
import { PMailClient } from './pmail-client.js';

/**
 * Test PMAIL Client
 * Kiểm tra xem PMAIL có thể kết nối IMAP và đọc email không
 */
async function testPMail() {
  console.log('========== PMAIL CLIENT TEST ==========\n');

  const client = new PMailClient();

  console.log('IMAP Config:', {
    user: client.imapConfig.user,
    host: client.imapConfig.host,
    port: client.imapConfig.port,
    hasPassword: !!client.imapConfig.password
  });

  if (!client.imapConfig.password) {
    console.error('\n❌ ERROR: PMAIL_IMAP_PASSWORD chưa được set trong .env file!');
    console.log('Vui lòng thêm vào .env:');
    console.log('PMAIL_IMAP_PASSWORD=your_gmail_app_password');
    process.exit(1);
  }

  console.log('\n1. Khởi tạo client...');
  await client.initialize();
  console.log('✅ Client initialized\n');

  console.log('2. Kiểm tra các domain còn hoạt động...');
  const testDomains = [
    'mmocoffee.io.vn',
    'phatdinh24.id.vn', 
    'playmaker.id.vn'
  ];
  
  console.log('Domains to test:', testDomains.join(', '));
  console.log('✅ Sẽ search email với bất kỳ domain nào ở trên\n');

  console.log('3. Tìm email trong Gmail inbox có chứa các domain...');
  
  // Tìm email bất kỳ từ các domain còn hoạt động
  const testEmail = 'test@mmocoffee.io.vn'; // Fallback
  client.setCurrentEmail(testEmail);
  
  console.log('(Đang fetch tất cả emails gần đây để tìm matches...)\n');

  const result = await client.fetchMessages();

  console.log('========== FETCH RESULT ==========');
  console.log('Success:', result.success);
  console.log('Count:', result.count);
  console.log('Messages found:', result.messages?.length || 0);

  if (result.error) {
    console.log('❌ Error:', result.error);
  }

  if (result.messages && result.messages.length > 0) {
    console.log('\n✅ Found messages:');
    result.messages.forEach((msg, idx) => {
      console.log(`\n--- Message ${idx + 1} ---`);
      console.log('Subject:', msg.subject);
      console.log('From:', msg.sender_name, '<' + msg.sender_email + '>');
      console.log('Date:', msg.date);
      console.log('Content preview:', (msg.content || '').substring(0, 100) + '...');
    });
  } else {
    console.log('\n⚠️  Không tìm thấy email nào match với:', testEmail);
    console.log('\n💡 Lý do có thể:');
    console.log('  1. Domain @mmocoffee.io.vn chưa có MX record setup');
    console.log('  2. Gmail chưa được config email forwarding từ domain này');
    console.log('  3. Chưa có ai gửi email đến ' + testEmail);
    console.log('\n📝 Để test thử:');
    console.log('  - Gửi email test từ một email khác đến: ' + testEmail);
    console.log('  - Hoặc gửi đến: phiphi19784321@gmail.com với subject chứa: ' + testEmail);
    console.log('  - Sau đó chạy lại script này');
  }

  console.log('\n========== TEST HOÀN TẤT ==========\n');
}

// Run test
testPMail().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
