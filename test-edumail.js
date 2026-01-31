import { EduMailClient } from './src/edumail-client.js';

/**
 * Test script cho EduMail Client
 */
async function testEduMail() {
  console.log('========== TEST EDUMAIL CLIENT ==========');
  
  const client = new EduMailClient();
  
  // Test 1: Initialize
  console.log('\n[TEST 1] Initializing client...');
  const initialized = await client.initialize();
  console.log('Initialized:', initialized);
  console.log('CSRF Token:', client.csrfToken ? 'OK' : 'MISSING');
  console.log('Cookies:', Object.keys(client.cookies).length, 'cookies');
  console.log('Snapshots:', {
    actions: !!client.componentSnapshots.actions,
    app: !!client.componentSnapshots.app
  });
  
  // Test 2: Get domains
  console.log('\n[TEST 2] Getting domains...');
  const domains = client.getDomains();
  console.log('Domains:', domains);
  
  // Test 3: Create random email
  console.log('\n[TEST 3] Creating random email...');
  const randomResult = await client.createRandomEmail();
  console.log('Random email result:', randomResult);
  
  if (randomResult.success) {
    const email = randomResult.email;
    console.log('Created email:', email);
    
    // Test 4: Fetch messages
    console.log('\n[TEST 4] Fetching messages...');
    const messagesResult = await client.fetchMessages();
    console.log('Messages result:', {
      success: messagesResult.success,
      count: messagesResult.count,
      error: messagesResult.error
    });
    
    if (messagesResult.success && messagesResult.messages.length > 0) {
      console.log('First message:', messagesResult.messages[0]);
    }
  }
  
  // Test 5: Proxy stats (nếu có)
  console.log('\n[TEST 5] Proxy stats...');
  const proxyStats = client.getProxyStats();
  if (proxyStats) {
    console.log('Proxy stats:', proxyStats);
  } else {
    console.log('Proxy not enabled');
  }
  
  console.log('\n========== TEST COMPLETED ==========');
}

// Run test
testEduMail().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
