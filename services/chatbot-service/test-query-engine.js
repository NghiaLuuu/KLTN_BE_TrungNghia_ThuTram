/**
 * 🧪 Test AI Query Engine
 * 
 * Test cases for MongoDB query generation with self-retry logic
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { handleQuery } = require('./src/services/queryEngine.service');

// Test cases
const testCases = [
  {
    name: 'Test 1: Tìm slot trống ngày cụ thể',
    prompt: 'Tìm slot trống ngày 7/11/2025',
    expectCollection: 'slots',
    expectSuccess: true
  },
  {
    name: 'Test 2: Tìm phòng X-quang đang hoạt động',
    prompt: 'Có phòng X-quang nào đang hoạt động?',
    expectCollection: 'rooms',
    expectSuccess: true
  },
  {
    name: 'Test 3: Tìm dịch vụ tẩy trắng răng',
    prompt: 'Tìm dịch vụ tẩy trắng răng',
    expectCollection: 'services',
    expectSuccess: true
  },
  {
    name: 'Test 4: Tìm bác sĩ chuyên khoa nha chu',
    prompt: 'Danh sách bác sĩ chuyên nha chu',
    expectCollection: 'users',
    expectSuccess: true
  },
  {
    name: 'Test 5: Tìm slot của bác sĩ cụ thể',
    prompt: 'Lịch trống của bác sĩ trong tuần này',
    expectCollection: 'slots',
    expectSuccess: true
  },
  {
    name: 'Test 6: Query phức tạp với nhiều điều kiện',
    prompt: 'Tìm slot trống ngày mai từ 9h đến 12h',
    expectCollection: 'slots',
    expectSuccess: true
  }
];

async function runTests() {
  console.log('🧪 ========================================');
  console.log('   AI QUERY ENGINE TEST SUITE');
  console.log('========================================\n');

  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    let passedTests = 0;
    let failedTests = 0;

    // Run each test case
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📝 ${testCase.name}`);
      console.log(`${'='.repeat(60)}`);
      console.log(`Prompt: "${testCase.prompt}"`);
      console.log(`Expected Collection: ${testCase.expectCollection}`);

      try {
        const startTime = Date.now();
        const result = await handleQuery(testCase.prompt);
        const duration = Date.now() - startTime;

        console.log(`\n⏱️ Duration: ${duration}ms`);
        console.log(`🔄 Retries: ${result.retries}`);

        if (result.success) {
          console.log('✅ Status: SUCCESS');
          console.log(`📊 Collection: ${result.query?.collection}`);
          console.log(`🔍 Filter:`, JSON.stringify(result.query?.filter, null, 2));
          console.log(`📈 Results Count: ${result.count}`);
          
          if (result.count > 0) {
            console.log(`📄 Sample Result:`, JSON.stringify(result.data[0], null, 2));
          }

          if (result.query?.collection === testCase.expectCollection) {
            console.log('🎉 TEST PASSED');
            passedTests++;
          } else {
            console.log(`⚠️ TEST WARNING: Expected collection "${testCase.expectCollection}" but got "${result.query?.collection}"`);
            passedTests++;
          }
        } else {
          console.log('❌ Status: FAILED');
          console.log(`Error: ${result.error}`);
          console.log('💔 TEST FAILED');
          failedTests++;
        }

      } catch (error) {
        console.error('❌ Test execution error:', error.message);
        console.log('💔 TEST FAILED');
        failedTests++;
      }

      // Delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Summary
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${passedTests}/${testCases.length}`);
    console.log(`❌ Failed: ${failedTests}/${testCases.length}`);
    console.log(`📈 Success Rate: ${((passedTests / testCases.length) * 100).toFixed(1)}%`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('💥 Test suite error:', error);
  } finally {
    // Cleanup
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run tests
runTests().catch(console.error);
