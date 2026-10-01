import 'dotenv/config';
import { PMailClient } from './src/pmail-client.js';

/**
 * Test với email thật từ Gmail inbox
 */
async function testRealEmail() {
  console.log('========== TEST PMAIL VỚI EMAIL THẬT ==========\n');

  const client = new PMailClient();
  
  // Email thật từ Gmail inbox
  const realEmail = 'test933932@playmaker.id.vn'; // Email mới nhất
  
  console.log('Testing với email:', realEmail);
  console.log('(Email này đã được gửi và nhận trong Gmail)\n');

  await client.initialize();
  client.setCurrentEmail(realEmail);

  console.log('Đang fetch messages...\n');
  const result = await client.fetchMessages();

  console.log('========== KẾT QUẢ ==========');
  console.log('Success:', result.success);
  console.log('Count:', result.count);
  
  if (result.messages && result.messages.length > 0) {
    console.log('\n✅ PMAIL HOẠT ĐỘNG! Tìm thấy email:\n');
    result.messages.forEach((msg, idx) => {
      console.log(`${idx + 1}. ${msg.subject}`);
      console.log(`   From: ${msg.sender_name} <${msg.sender_email}>`);
      console.log(`   Date: ${msg.date}`);
      console.log(`   Preview: ${(msg.content || '').substring(0, 100)}...\n`);
    });
  } else {
    console.log('\n❌ Không tìm thấy email');
    if (result.error) {
      console.log('Error:', result.error);
    }
  }
}

testRealEmail().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
