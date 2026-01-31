import { AppleClient } from './src/apple-client.js';

async function testApple() {
  console.log('========== TEST APPLE.EDU.PL ==========\n');

  const client = new AppleClient();

  // Test 1: Get domains
  console.log('1. Testing getDomains()...');
  const domains = await client.getDomains();
  console.log('Available domains:', domains);
  console.log('');

  // Test 2: Create random email
  console.log('2. Testing createRandomEmail()...');
  const randomResult = await client.createRandomEmail();
  console.log('Random email result:', randomResult);
  console.log('');

  if (randomResult.success) {
    const email = randomResult.email;
    const token = randomResult.token;

    // Test 3: Check inbox (should be empty)
    console.log('3. Testing fetchMessages() - empty inbox...');
    const messagesResult = await client.fetchMessages();
    console.log('Messages result:', messagesResult);
    console.log('');

    // Test 4: Wait and check again
    console.log('4. Waiting 10 seconds for potential messages...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    const messagesResult2 = await client.fetchMessages();
    console.log('Messages after wait:', messagesResult2);
    console.log('');

    // Test 5: If there are messages, read one
    if (messagesResult2.success && messagesResult2.messages.length > 0) {
      const firstMsg = messagesResult2.messages[0];
      console.log('5. Testing readMessage() for first message...');
      const readResult = await client.readMessage(firstMsg.id);
      console.log('Read message result:', {
        success: readResult.success,
        subject: readResult.message?.subject,
        bodyLength: readResult.message?.body?.length || 0
      });
      console.log('');

      // Test 6: Delete message
      console.log('6. Testing deleteMessage()...');
      const deleteResult = await client.deleteMessage(firstMsg.id);
      console.log('Delete result:', deleteResult);
      console.log('');
    }

    // Test 7: Create custom email
    if (domains.length > 0) {
      console.log('7. Testing createEmail() with custom username...');
      const customResult = await client.createEmail('testuser123', domains[0]);
      console.log('Custom email result:', customResult);
      console.log('');
    }
  }

  console.log('========== TEST COMPLETED ==========');
}

testApple().catch(console.error);
