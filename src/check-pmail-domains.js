import dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

/**
 * Kiểm tra MX records của các domain PMAIL
 */
async function checkDomains() {
  const domains = [
    'mmocoffee.io.vn',
    'phatdinh24.id.vn', 
    'playmaker.id.vn',
    'shopaccsheap.pro.vn'
  ];

  console.log('========== KIỂM TRA PMAIL DOMAINS ==========\n');
  console.log('Checking MX records for PMAIL domains...\n');

  for (const domain of domains) {
    try {
      console.log(`📧 Checking: ${domain}`);
      const mxRecords = await resolveMx(domain);
      
      if (mxRecords && mxRecords.length > 0) {
        console.log('   ✅ MX records found:');
        mxRecords.forEach(record => {
          console.log(`      - ${record.exchange} (priority: ${record.priority})`);
        });
      } else {
        console.log('   ⚠️  No MX records found');
      }
    } catch (error) {
      if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
        console.log('   ❌ Domain không tồn tại hoặc không có MX record');
      } else {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }
    console.log('');
  }

  console.log('========================================\n');
  console.log('💡 Lưu ý:');
  console.log('   - Domain cần có MX record để nhận email');
  console.log('   - Cần setup email forwarding từ domain → phiphi19784321@gmail.com');
  console.log('   - Hoặc sử dụng catch-all email redirect\n');
  
  console.log('📝 Nếu muốn dùng domain khác:');
  console.log('   1. Domain phải có MX record');
  console.log('   2. Setup email forwarding/catch-all');
  console.log('   3. Update domain list trong src/pmail-client.js\n');
}

checkDomains();
