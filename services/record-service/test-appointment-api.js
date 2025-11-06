const axios = require('axios');

async function testAppointmentAPI() {
  try {
    console.log('Testing appointment API...');
    const response = await axios.get('http://localhost:3006/api/appointment/by-ids', {
      params: { ids: '690b77c7c036d5cc58dfa38e,690c291f24deb937e5da0317' }
    });
    
    console.log('✅ Success!');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

testAppointmentAPI();
