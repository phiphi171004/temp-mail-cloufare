/**
 * File test để debug và kiểm tra cookies
 */

import { TempMail } from './tempmail.js';

async function test() {
  console.log('🧪 Bắt đầu test TempMail\n');

  const tempMail = new TempMail();

  // 1. Test khởi tạo và xem cookies
  console.log('📡 Đang khởi tạo...');
  const initialized = await tempMail.init();
  
  if (!initialized) {
    console.log('❌ Khởi tạo thất bại');
    return;
  }
  
  console.log('✅ Khởi tạo thành công!\n');
  
  // Debug: Xem cookies đã lưu
  console.log('🍪 Cookies đã lưu:');
  const cookies = tempMail.client.cookies;
  Object.entries(cookies).forEach(([name, value]) => {
    console.log(`   ${name}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
  });
  console.log('');
  
  // Debug: Xem CSRF token
  console.log('🔑 CSRF Token:', tempMail.client.csrfToken);
  console.log('');

  // 2. Test tạo email tùy chỉnh
  console.log('📝 Test tạo email với username "test123"...');
  const result1 = await tempMail.createEmail('test123');
  
  if (result1.success) {
    console.log(`✅ ${result1.message}`);
  } else {
    console.log(`❌ Lỗi: ${result1.error}`);
  }
  console.log('');

  // 3. Test lấy thư
  if (result1.success) {
    console.log('📬 Test lấy danh sách thư...');
    const result2 = await tempMail.fetchMessages();
    
    if (result2.success) {
      console.log(`✅ Tìm thấy ${result2.count} thư`);
      if (result2.count > 0) {
        result2.messages.forEach((msg, i) => {
          console.log(`\n   Thư ${i + 1}:`);
          console.log(`   Từ: ${msg.from || 'N/A'}`);
          console.log(`   Tiêu đề: ${msg.subject || 'N/A'}`);
        });
      }
    } else {
      console.log(`❌ Lỗi: ${result2.error}`);
    }
    console.log('');
  }

  // 4. Test tạo email ngẫu nhiên
  console.log('🎲 Test tạo email ngẫu nhiên...');
  const result3 = await tempMail.createRandomEmail();
  
  if (result3.success) {
    console.log(`✅ ${result3.message}`);
  } else {
    console.log(`❌ Lỗi: ${result3.error}`);
  }
  console.log('');

  console.log('✅ Test hoàn tất!\n');
}

// Chạy test
test().catch(error => {
  console.error('❌ Lỗi:', error.message);
  console.error(error.stack);
  process.exit(1);
});

