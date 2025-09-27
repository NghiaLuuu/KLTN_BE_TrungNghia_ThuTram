// Simple Redis test
require('dotenv').config();
const redis = require('redis');

console.log('🔍 Testing Redis Connection...');
console.log('Environment:', {
  REDIS_URL: process.env.REDIS_URL,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD ? '***' : 'NOT SET'
});

async function testRedis() {
  try {
    const client = redis.createClient({
      url: process.env.REDIS_URL
    });

    client.on('connect', () => console.log('✅ Redis connected'));
    client.on('error', (err) => console.error('❌ Redis error:', err));

    await client.connect();
    console.log('✅ Connection successful');
    
    // Test a simple command
    await client.set('test', 'hello');
    const value = await client.get('test');
    console.log('✅ Set/Get test:', value);

    await client.quit();
    console.log('✅ Connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testRedis();