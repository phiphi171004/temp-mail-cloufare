/**
 * Ví dụ sử dụng TempMail API
 */

import { TempMail } from './tempmail.js';

async function example() {
  console.log('🚀 Bắt đầu demo TempMail API\n');

  // 1. Khởi tạo
  const tempMail = new TempMail();
  console.log('📡 Đang khởi tạo...');
  await tempMail.init();
  console.log('✅ Khởi tạo thành công!\n');

  // 2. Tạo email tùy chỉnh
  console.log('📝 Tạo email với username "demo123"...');
  const result1 = await tempMail.createEmail('demo123');
  if (result1.success) {
    console.log(`✅ ${result1.message}\n`);
  } else {
    console.log(`❌ Lỗi: ${result1.error}\n`);
  }

  // 3. Lấy email hiện tại
  console.log('📧 Email hiện tại:', tempMail.getCurrentEmail(), '\n');

  // 4. Lấy danh sách domains
  console.log('🌐 Danh sách domains có sẵn:');
  const domains = tempMail.getDomains();
  console.log(domains.slice(0, 5).join(', '), '...\n');

  // 5. Đổi domain
  console.log('🔄 Đổi domain sang "befhopcharity.io.vn"...');
  const result2 = await tempMail.setDomain('befhopcharity.io.vn');
  if (result2.success) {
    console.log(`✅ Đã đổi domain thành: ${result2.domain}\n`);
  }

  // 6. Tạo email ngẫu nhiên
  console.log('🎲 Tạo email ngẫu nhiên...');
  const result3 = await tempMail.createRandomEmail();
  if (result3.success) {
    console.log(`✅ ${result3.message}\n`);
  }

  // 7. Lấy tất cả emails đã tạo
  console.log('📋 Tất cả emails đã tạo:');
  const allEmails = tempMail.getAllEmails();
  allEmails.forEach((email, index) => {
    console.log(`   ${index + 1}. ${email}`);
  });
  console.log('');

  // 8. Lấy danh sách thư
  console.log('📬 Đang kiểm tra hộp thư...');
  const result4 = await tempMail.fetchMessages();
  if (result4.success) {
    console.log(`✅ Tìm thấy ${result4.count} thư`);
    if (result4.count > 0) {
      console.log('\nDanh sách thư:');
      result4.messages.forEach((msg, index) => {
        console.log(`\n   Thư ${index + 1}:`);
        console.log(`   Từ: ${msg.from || 'N/A'}`);
        console.log(`   Tiêu đề: ${msg.subject || 'N/A'}`);
        console.log(`   Thời gian: ${msg.time || msg.date || 'N/A'}`);
      });
    } else {
      console.log('   📭 Hộp thư trống\n');
    }
  }

  // 9. Auto-refresh demo (lấy thư mỗi 5 giây)
  console.log('\n🔄 Bắt đầu auto-refresh hộp thư (nhấn Ctrl+C để dừng)...\n');
  
  let refreshCount = 0;
  const maxRefresh = 3; // Chỉ refresh 3 lần để demo

  const interval = setInterval(async () => {
    refreshCount++;
    console.log(`[${new Date().toLocaleTimeString()}] Đang làm mới lần ${refreshCount}...`);
    
    const result = await tempMail.fetchMessages();
    if (result.success) {
      console.log(`   ✅ ${result.count} thư\n`);
    } else {
      console.log(`   ❌ Lỗi: ${result.error}\n`);
    }

    if (refreshCount >= maxRefresh) {
      clearInterval(interval);
      console.log('✅ Demo hoàn tất!\n');
      
      // 10. Xóa email (optional)
      console.log('🗑️  Xóa email hiện tại...');
      const deleteResult = await tempMail.deleteEmail();
      if (deleteResult.success) {
        console.log(`✅ ${deleteResult.message}\n`);
      }
      
      console.log('👋 Tạm biệt!\n');
    }
  }, 5000);
}

// Chạy example
example().catch(error => {
  console.error('❌ Lỗi:', error.message);
  process.exit(1);
});

