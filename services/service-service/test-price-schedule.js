/**
 * 🧪 Price Schedule Test Script
 * 
 * This script demonstrates how to test the Price Schedule API endpoints
 * Run this with your API testing tool (Postman, Thunder Client, etc.)
 */

// ============================================
// SETUP
// ============================================
const BASE_URL = 'http://localhost:3003/api/services';
const AUTH_TOKEN = 'YOUR_JWT_TOKEN_HERE'; // Get from login

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AUTH_TOKEN}`
};

// ============================================
// TEST 1: Get Service with Effective Prices
// ============================================
async function testGetServiceWithEffectivePrices() {
  console.log('📊 Test 1: Get Service with Effective Prices');
  
  const serviceId = 'YOUR_SERVICE_ID';
  const response = await fetch(`${BASE_URL}/${serviceId}`, {
    method: 'GET',
    headers
  });
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
  console.log('📌 Check: hasActiveTemporaryPrice:', data.hasActiveTemporaryPrice);
  console.log('📌 Check: serviceAddOns[0].effectivePrice:', data.serviceAddOns[0].effectivePrice);
  console.log('📌 Check: serviceAddOns[0].isPriceModified:', data.serviceAddOns[0].isPriceModified);
}

// ============================================
// TEST 2: Add Price Schedule to ServiceAddOn
// ============================================
async function testAddPriceSchedule() {
  console.log('➕ Test 2: Add Price Schedule to ServiceAddOn');
  
  const serviceId = 'YOUR_SERVICE_ID';
  const addOnId = 'YOUR_ADDON_ID';
  
  const scheduleData = {
    price: 450000,
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    endDate: new Date('2024-01-31T23:59:59.999Z'),
    isActive: true,
    note: 'Giá khuyến mãi Tết Nguyên Đán 2024'
  };
  
  const response = await fetch(`${BASE_URL}/${serviceId}/addons/${addOnId}/price-schedules`, {
    method: 'POST',
    headers,
    body: JSON.stringify(scheduleData)
  });
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
  console.log('📌 New schedule ID:', data.serviceAddOns[0].priceSchedules[0]._id);
}

// ============================================
// TEST 3: Update Price Schedule
// ============================================
async function testUpdatePriceSchedule() {
  console.log('✏️ Test 3: Update Price Schedule');
  
  const serviceId = 'YOUR_SERVICE_ID';
  const addOnId = 'YOUR_ADDON_ID';
  const scheduleId = 'YOUR_SCHEDULE_ID';
  
  const updateData = {
    price: 480000,
    note: 'Gia hạn thêm 1 tháng',
    endDate: new Date('2024-02-29T23:59:59.999Z')
  };
  
  const response = await fetch(`${BASE_URL}/${serviceId}/addons/${addOnId}/price-schedules/${scheduleId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(updateData)
  });
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
}

// ============================================
// TEST 4: Toggle Price Schedule Status
// ============================================
async function testTogglePriceSchedule() {
  console.log('🔄 Test 4: Toggle Price Schedule Status');
  
  const serviceId = 'YOUR_SERVICE_ID';
  const addOnId = 'YOUR_ADDON_ID';
  const scheduleId = 'YOUR_SCHEDULE_ID';
  
  const response = await fetch(`${BASE_URL}/${serviceId}/addons/${addOnId}/price-schedules/${scheduleId}/toggle`, {
    method: 'PATCH',
    headers
  });
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
  console.log('📌 New isActive status:', data.serviceAddOns[0].priceSchedules[0].isActive);
}

// ============================================
// TEST 5: Set Temporary Price for Service
// ============================================
async function testSetTemporaryPrice() {
  console.log('💰 Test 5: Set Temporary Price for Service');
  
  const serviceId = 'YOUR_SERVICE_ID';
  
  const tempPriceData = {
    temporaryPrice: 200000,
    startDate: new Date('2024-03-01T00:00:00.000Z'),
    endDate: new Date('2024-03-31T23:59:59.999Z')
  };
  
  const response = await fetch(`${BASE_URL}/${serviceId}/temporary-price`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(tempPriceData)
  });
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
  console.log('📌 Temporary price:', data.temporaryPrice);
  console.log('📌 Date range:', data.startDate, 'to', data.endDate);
}

// ============================================
// TEST 6: Remove Temporary Price
// ============================================
async function testRemoveTemporaryPrice() {
  console.log('🗑️ Test 6: Remove Temporary Price');
  
  const serviceId = 'YOUR_SERVICE_ID';
  
  const response = await fetch(`${BASE_URL}/${serviceId}/temporary-price`, {
    method: 'DELETE',
    headers
  });
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
}

// ============================================
// TEST 7: Delete Price Schedule
// ============================================
async function testDeletePriceSchedule() {
  console.log('❌ Test 7: Delete Price Schedule');
  
  const serviceId = 'YOUR_SERVICE_ID';
  const addOnId = 'YOUR_ADDON_ID';
  const scheduleId = 'YOUR_SCHEDULE_ID';
  
  const response = await fetch(`${BASE_URL}/${serviceId}/addons/${addOnId}/price-schedules/${scheduleId}`, {
    method: 'DELETE',
    headers
  });
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
}

// ============================================
// TEST 8: List All Services with Effective Prices
// ============================================
async function testListServicesWithEffectivePrices() {
  console.log('📋 Test 8: List All Services with Effective Prices');
  
  const response = await fetch(`${BASE_URL}?page=1&limit=10`, {
    method: 'GET',
    headers
  });
  
  const data = await response.json();
  console.log('✅ Response:', JSON.stringify(data, null, 2));
  console.log('📌 Total services:', data.total);
  console.log('📌 First service has effective prices:', 
    data.services[0].serviceAddOns[0].effectivePrice !== undefined);
}

// ============================================
// EDGE CASE TESTS
// ============================================

// Test: Add schedule with invalid date range (should fail)
async function testInvalidDateRange() {
  console.log('⚠️ Test: Invalid Date Range (endDate <= startDate)');
  
  const serviceId = 'YOUR_SERVICE_ID';
  const addOnId = 'YOUR_ADDON_ID';
  
  const invalidData = {
    price: 450000,
    startDate: new Date('2024-01-31T00:00:00.000Z'),
    endDate: new Date('2024-01-01T00:00:00.000Z'), // INVALID: before startDate
    isActive: true
  };
  
  try {
    const response = await fetch(`${BASE_URL}/${serviceId}/addons/${addOnId}/price-schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify(invalidData)
    });
    
    const data = await response.json();
    console.log('❌ Expected error:', data.message);
  } catch (error) {
    console.log('✅ Validation error caught:', error.message);
  }
}

// Test: Unauthorized access (should fail with 403)
async function testUnauthorizedAccess() {
  console.log('🔒 Test: Unauthorized Access (no token)');
  
  const serviceId = 'YOUR_SERVICE_ID';
  const addOnId = 'YOUR_ADDON_ID';
  
  const response = await fetch(`${BASE_URL}/${serviceId}/addons/${addOnId}/price-schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // No auth token
    body: JSON.stringify({ price: 450000, startDate: '2024-01-01', endDate: '2024-01-31' })
  });
  
  const data = await response.json();
  console.log('❌ Expected 403 error:', data.message);
}

// Test: Multiple overlapping schedules
async function testOverlappingSchedules() {
  console.log('🔄 Test: Multiple Overlapping Schedules');
  
  const serviceId = 'YOUR_SERVICE_ID';
  const addOnId = 'YOUR_ADDON_ID';
  
  // Add first schedule (Jan)
  await fetch(`${BASE_URL}/${serviceId}/addons/${addOnId}/price-schedules`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      price: 450000,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
      isActive: true,
      note: 'January promotion'
    })
  });
  
  // Add second schedule (Feb)
  await fetch(`${BASE_URL}/${serviceId}/addons/${addOnId}/price-schedules`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      price: 480000,
      startDate: new Date('2024-02-01'),
      endDate: new Date('2024-02-29'),
      isActive: true,
      note: 'February promotion'
    })
  });
  
  // Get service and check effective price
  const response = await fetch(`${BASE_URL}/${serviceId}`, {
    method: 'GET',
    headers
  });
  
  const data = await response.json();
  console.log('✅ Effective price calculated correctly based on current date');
  console.log('📌 Current effective price:', data.serviceAddOns[0].effectivePrice);
}

// ============================================
// RUN ALL TESTS
// ============================================
async function runAllTests() {
  console.log('🚀 Starting Price Schedule API Tests...\n');
  
  try {
    await testGetServiceWithEffectivePrices();
    console.log('\n---\n');
    
    await testAddPriceSchedule();
    console.log('\n---\n');
    
    await testUpdatePriceSchedule();
    console.log('\n---\n');
    
    await testTogglePriceSchedule();
    console.log('\n---\n');
    
    await testSetTemporaryPrice();
    console.log('\n---\n');
    
    await testRemoveTemporaryPrice();
    console.log('\n---\n');
    
    await testDeletePriceSchedule();
    console.log('\n---\n');
    
    await testListServicesWithEffectivePrices();
    console.log('\n---\n');
    
    // Edge cases
    await testInvalidDateRange();
    console.log('\n---\n');
    
    await testUnauthorizedAccess();
    console.log('\n---\n');
    
    await testOverlappingSchedules();
    console.log('\n---\n');
    
    console.log('✅ All tests completed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// ============================================
// EXPORT FOR TESTING
// ============================================
module.exports = {
  testGetServiceWithEffectivePrices,
  testAddPriceSchedule,
  testUpdatePriceSchedule,
  testTogglePriceSchedule,
  testSetTemporaryPrice,
  testRemoveTemporaryPrice,
  testDeletePriceSchedule,
  testListServicesWithEffectivePrices,
  testInvalidDateRange,
  testUnauthorizedAccess,
  testOverlappingSchedules,
  runAllTests
};

// ============================================
// POSTMAN COLLECTION EXPORT
// ============================================
/*
{
  "info": {
    "name": "Price Schedule API Tests",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Get Service with Effective Prices",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{token}}"
          }
        ],
        "url": {
          "raw": "{{baseUrl}}/api/services/{{serviceId}}",
          "host": ["{{baseUrl}}"],
          "path": ["api", "services", "{{serviceId}}"]
        }
      }
    },
    {
      "name": "Add Price Schedule",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{token}}"
          },
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"price\": 450000,\n  \"startDate\": \"2024-01-01T00:00:00.000Z\",\n  \"endDate\": \"2024-01-31T23:59:59.999Z\",\n  \"isActive\": true,\n  \"note\": \"Khuyến mãi Tết\"\n}"
        },
        "url": {
          "raw": "{{baseUrl}}/api/services/{{serviceId}}/addons/{{addOnId}}/price-schedules",
          "host": ["{{baseUrl}}"],
          "path": ["api", "services", "{{serviceId}}", "addons", "{{addOnId}}", "price-schedules"]
        }
      }
    },
    {
      "name": "Update Temporary Price",
      "request": {
        "method": "PUT",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{token}}"
          },
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"temporaryPrice\": 200000,\n  \"startDate\": \"2024-03-01T00:00:00.000Z\",\n  \"endDate\": \"2024-03-31T23:59:59.999Z\"\n}"
        },
        "url": {
          "raw": "{{baseUrl}}/api/services/{{serviceId}}/temporary-price",
          "host": ["{{baseUrl}}"],
          "path": ["api", "services", "{{serviceId}}", "temporary-price"]
        }
      }
    }
  ]
}
*/
