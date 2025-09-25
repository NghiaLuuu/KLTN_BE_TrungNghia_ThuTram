const axios = require('axios');

async function testSimulate() {
  try {
    console.log('🧪 Testing simulate API...');
    
    const response = await axios.post('http://localhost:3005/api/auto-schedule/simulate', {
      simulateDate: '2025-09-30'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OGQ0ZTY0OWUxOWIwNTJjOWY4MTY1YjIiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NTg3ODMyMTIsImV4cCI6MTc1ODg2OTYxMn0.vL_ViIUj85e0LMmCBV4iHvdkjItF3ecMFrNLOGdqmvI'
      },
      timeout: 10000
    });

    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.status, error.response.data);
    } else {
      console.error('❌ Network Error:', error.message);
    }
  }
}

// Test with bypass auth (create temporary endpoint)
async function testWithoutAuth() {
  try {
    console.log('🧪 Testing simulate API without auth...');
    
    const response = await axios.post('http://localhost:3005/api/auto-schedule/test-simulate', {
      simulateDate: '2025-09-30'
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.status, error.response.data);
    } else {
      console.error('❌ Network Error:', error.message);
    }
  }
}

// Run tests
testSimulate().then(() => {
  console.log('\n--- Testing without auth ---\n');
  testWithoutAuth();
});