const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

// Test cases for the student progress endpoint
const testCases = [
  {
    name: 'Complete username test',
    username: 'student123',
    courseId: 1,
    description: 'Test with a complete username'
  },
  {
    name: 'Partial username test',
    username: '45678974',
    courseId: 1,
    description: 'Test with partial username that should match "45678974-2"'
  },
  {
    name: 'Invalid course ID test',
    username: 'student123',
    courseId: 'invalid',
    description: 'Test with invalid course ID to verify error handling'
  },
  {
    name: 'Missing parameters test',
    description: 'Test with missing parameters to verify error handling'
  }
];

async function testStudentProgress() {
  console.log('🧪 Testing Student Progress Endpoint');
  console.log('=====================================\n');

  // First, check if the server is running
  try {
    const healthResponse = await axios.get(`${API_BASE}/health`);
    console.log('✅ Server is running and healthy');
    console.log(`📋 Server info: ${healthResponse.data.message}\n`);
  } catch (error) {
    console.error('❌ Server is not running or health check failed');
    console.error('Please start the server with: npm run dev\n');
    return;
  }

  // Test each case
  for (const testCase of testCases) {
    console.log(`🔍 Test: ${testCase.name}`);
    console.log(`📝 Description: ${testCase.description}`);
    
    try {
      let url = `${API_BASE}/student-progress`;
      const params = new URLSearchParams();
      
      if (testCase.username) params.append('username', testCase.username);
      if (testCase.courseId) params.append('courseId', testCase.courseId.toString());
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      console.log(`🌐 Request: GET ${url}`);
      
      const response = await axios.get(url);
      
      if (response.data.success) {
        console.log('✅ Success!');
        console.log('📊 Response data:');
        console.log(JSON.stringify(response.data.data, null, 2));
      } else {
        console.log('⚠️  API returned error:');
        console.log(`   Message: ${response.data.error?.message}`);
        console.log(`   Code: ${response.data.error?.code}`);
      }
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ HTTP ${error.response.status} Error:`);
        if (error.response.data.error) {
          console.log(`   Message: ${error.response.data.error.message}`);
          console.log(`   Code: ${error.response.data.error.code}`);
        } else {
          console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
        }
      } else {
        console.log(`❌ Network Error: ${error.message}`);
      }
    }
    
    console.log('─'.repeat(50) + '\n');
  }

  console.log('🏁 Testing completed!');
  console.log('\n💡 Note: Some tests may fail if there are no matching users in your Moodle instance');
  console.log('   or if the Moodle connection is not properly configured.');
}

// Additional function to test the API info endpoint
async function testApiInfo() {
  try {
    console.log('📋 API Endpoints:');
    const response = await axios.get(API_BASE);
    console.log(JSON.stringify(response.data.endpoints, null, 2));
    console.log('');
  } catch (error) {
    console.error('❌ Could not fetch API info');
  }
}

// Run tests
async function runTests() {
  await testApiInfo();
  await testStudentProgress();
}

runTests().catch(console.error);
