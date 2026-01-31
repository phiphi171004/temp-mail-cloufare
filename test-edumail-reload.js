import { TempMail } from './src/tempmail.js';

/**
 * Test script cho EduMail reload scenario
 */
async function testEduMailReload() {
  console.log('========== TEST EDUMAIL RELOAD ==========');
  
  // Scenario 1: Tạo email mới
  console.log('\n[SCENARIO 1] Creating new email...');
  const tempMail1 = new TempMail('edumail');
  await tempMail1.init('edumail');
  
  const createResult = await tempMail1.createRandomEmail();
  console.log('Create result:', createResult);
  
  if (!createResult.success) {
    console.error('Failed to create email');
    process.exit(1);
  }
  
  const email = createResult.email;
  const cookies = createResult.cookies; // Lưu cookies
  console.log('Created email:', email);
  console.log('Cookies saved:', !!cookies);
  
  // Fetch messages
  console.log('\n[SCENARIO 1] Fetching messages...');
  const messages1 = await tempMail1.fetchMessages();
  console.log('Messages:', messages1.count);
  
  // Scenario 2: Simulate reload (new session)
  console.log('\n[SCENARIO 2] Simulating reload with new session...');
  const tempMail2 = new TempMail('edumail');
  await tempMail2.init('edumail');
  
  // Set email và cookies từ session cũ
  tempMail2.currentEmail = email;
  tempMail2.client.savedCookies = cookies; // QUAN TRỌNG: Set cookies để restore
  
  // Sync email (giống khi reload)
  console.log('[SCENARIO 2] Syncing email on reload...');
  try {
    await tempMail2.syncEmailOnReload();
    console.log('[SCENARIO 2] Sync successful!');
    
    // Fetch messages sau khi sync
    console.log('[SCENARIO 2] Fetching messages after sync...');
    const messages2 = await tempMail2.fetchMessages();
    console.log('Messages:', messages2.count);
    
    console.log('\n========== TEST PASSED ==========');
  } catch (error) {
    console.error('[SCENARIO 2] Sync failed:', error.message);
    console.log('\n========== TEST FAILED ==========');
    process.exit(1);
  }
}

// Run test
testEduMailReload().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
