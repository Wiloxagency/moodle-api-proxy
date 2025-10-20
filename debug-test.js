const axios = require('axios');

async function testEndpoint() {
  try {
    console.log('Testing student progress endpoint...');
    const response = await axios.get('http://localhost:3000/api/student-progress?username=testuser&courseId=1', {
      timeout: 15000
    });
    
    console.log('SUCCESS:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (error.response) {
      console.log('HTTP Error Status:', error.response.status);
      console.log('HTTP Error Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.log('Network Error - No response received');
      console.log('Is the server running? Try: npm run dev');
    } else {
      console.log('Error:', error.message);
    }
  }
}

testEndpoint();
