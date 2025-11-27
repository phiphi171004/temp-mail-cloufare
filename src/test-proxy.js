#!/usr/bin/env node

/**
 * Test Proxy Mode
 * Script để test xem proxy mode có hoạt động không
 */

import { TempMail } from './tempmail.js';
import { CONFIG } from './config.js';

console.log('\n╔════════════════════════════════════════╗');
console.log('║     🧪 Testing Proxy Mode              ║');
console.log('╚════════════════════════════════════════╝\n');

// Check configuration
console.log('📋 Configuration:');
console.log(`   USE_PROXY: ${CONFIG.USE_PROXY ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`   SCRAPERAPI_KEY: ${CONFIG.SCRAPERAPI_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`   Mode: ${CONFIG.USE_PROXY ? '🔄 PROXY' : '⚡ DIRECT'}\n`);

if (CONFIG.USE_PROXY && !CONFIG.SCRAPERAPI_KEY) {
  console.error('❌ ERROR: USE_PROXY=true but SCRAPERAPI_KEY is not set!');
  console.error('   Please add SCRAPERAPI_KEY to your .env file\n');
  process.exit(1);
}

async function testProxyMode() {
  const tempMail = new TempMail();
  
  try {
    // Test 1: Initialize
    console.log('🔧 Test 1: Initialize session...');
    const initialized = await tempMail.init();
    
    if (!initialized) {
      console.error('❌ Failed to initialize session\n');
      process.exit(1);
    }
    console.log('✅ Session initialized successfully\n');
    
    // Test 2: Create random email
    console.log('📧 Test 2: Create random email...');
    const emailResult = await tempMail.createRandomEmail();
    
    if (!emailResult.success) {
      console.error(`❌ Failed to create email: ${emailResult.error}\n`);
      process.exit(1);
    }
    console.log(`✅ Email created: ${emailResult.email}\n`);
    
    // Test 3: Fetch messages
    console.log('📬 Test 3: Fetch messages...');
    const messagesResult = await tempMail.fetchMessages();
    
    if (!messagesResult.success) {
      console.error(`❌ Failed to fetch messages: ${messagesResult.error}\n`);
      process.exit(1);
    }
    console.log(`✅ Messages fetched: ${messagesResult.count} messages\n`);
    
    // Test 4: Check stats (nếu dùng proxy)
    if (CONFIG.USE_PROXY) {
      console.log('📊 Test 4: Check proxy stats...');
      const stats = tempMail.client.getProxyStats();
      
      if (stats) {
        console.log('✅ Proxy Stats:');
        console.log(`   Total Requests: ${stats.totalRequests}`);
        console.log(`   Successful: ${stats.successfulRequests}`);
        console.log(`   Failed: ${stats.failedRequests}`);
        console.log(`   Success Rate: ${stats.successRate}%`);
        console.log(`   Avg Response Time: ${stats.averageResponseTime}ms`);
        
        if (stats.errors.length > 0) {
          console.log(`   Recent Errors: ${stats.errors.length}`);
        }
        console.log('');
      }
    }
    
    // Test 5: Delete email
    console.log('🗑️  Test 5: Delete email...');
    const deleteResult = await tempMail.deleteEmail();
    
    if (!deleteResult.success) {
      console.error(`❌ Failed to delete email: ${deleteResult.error}\n`);
      process.exit(1);
    }
    console.log(`✅ Email deleted\n`);
    
    // Summary
    console.log('╔════════════════════════════════════════╗');
    console.log('║     ✅ All tests passed!               ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    if (CONFIG.USE_PROXY) {
      console.log('🎉 Proxy mode is working correctly!');
      console.log('   You can now deploy to Render/Railway.\n');
    } else {
      console.log('✅ Direct mode is working correctly!');
      console.log('   This is perfect for local development.\n');
    }
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:');
    console.error(`   ${error.message}\n`);
    
    if (error.response) {
      console.error('Response details:');
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Status Text: ${error.response.statusText}`);
      console.error(`   Data:`, error.response.data);
    }
    
    console.error('\n💡 Troubleshooting:');
    if (CONFIG.USE_PROXY) {
      console.error('   1. Check your SCRAPERAPI_KEY is correct');
      console.error('   2. Verify you have remaining quota at https://www.scraperapi.com/dashboard');
      console.error('   3. Check your internet connection');
      console.error('   4. Try again in a few minutes\n');
    } else {
      console.error('   1. Check your internet connection');
      console.error('   2. The target website might be down');
      console.error('   3. Try enabling proxy mode if this persists\n');
    }
    
    process.exit(1);
  }
}

// Run tests
testProxyMode();

