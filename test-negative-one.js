const axios = require('axios');

async function testNegativeOneResponse() {
  try {
    console.log('🧪 Testing -1 Response for Unavailable Data');
    console.log('===============================================\n');
    
    const response = await axios.get('http://localhost:3000/api/student-progress', {
      params: {
        username: '16740465', // The username you mentioned that was causing issues
        courseId: 327 // The course ID you mentioned
      },
      timeout: 15000
    });
    
    console.log('✅ Request successful!');
    console.log('📊 Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Verify the response structure
    if (response.data.success) {
      const data = response.data.data;
      console.log('\n🔍 Analysis:');
      console.log(`- Progress Percentage: ${data.progressPercentage}`);
      console.log(`- Attendance Percentage: ${data.studentAttendancePercentage}`);
      console.log(`- Theoretical Grade: ${data.theoreticalGrade}`);
      console.log(`- Theoretical Status: ${data.theoreticalStatus}`);
      console.log(`- Practical Grade: ${data.practicalGrade}`);
      console.log(`- Practical Status: ${data.practicalStatus}`);
      console.log(`- Final Grade: ${data.finalGrade}`);
      console.log(`- Course Status: ${data.courseStatus}`);
      console.log(`- Observation: ${data.observation || 'N/A'}`);
      
      // Check if values are -1 as expected for unavailable data
      const hasNegativeOnes = [
        data.progressPercentage,
        data.studentAttendancePercentage,
        data.theoreticalGrade,
        data.practicalGrade,
        data.finalGrade
      ].some(value => value === -1);
      
      if (hasNegativeOnes) {
        console.log('\n✅ SUCCESS: Found -1 values for unavailable data as expected!');
      } else {
        console.log('\n⚠️  Note: All values are available (no -1 values found)');
      }
    } else {
      console.log('\n❌ Response indicates failure, but this should not happen with the new logic');
    }
    
  } catch (error) {
    if (error.response) {
      console.log('❌ HTTP Error Status:', error.response.status);
      console.log('Error details:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 404) {
        console.log('\n⚠️  This should not happen anymore - the endpoint should return -1 values instead of 404');
      }
    } else {
      console.log('❌ Network Error:', error.message);
      console.log('Is the server running?');
    }
  }
}

async function testMultipleScenarios() {
  const testCases = [
    { username: '16740465', courseId: 327, description: 'Original failing case' },
    { username: 'nonexistent', courseId: 1, description: 'Completely non-existent user' },
    { username: 'test', courseId: 999, description: 'Non-existent course' }
  ];
  
  console.log('🧪 Testing Multiple Scenarios');
  console.log('==============================\n');
  
  for (const testCase of testCases) {
    console.log(`📋 Testing: ${testCase.description}`);
    console.log(`   Username: ${testCase.username}, Course ID: ${testCase.courseId}`);
    
    try {
      const response = await axios.get('http://localhost:3000/api/student-progress', {
        params: {
          username: testCase.username,
          courseId: testCase.courseId
        },
        timeout: 10000
      });
      
      if (response.data.success) {
        const data = response.data.data;
        const negativeCount = [
          data.progressPercentage,
          data.studentAttendancePercentage,
          data.theoreticalGrade,
          data.practicalGrade,
          data.finalGrade
        ].filter(value => value === -1).length;
        
        console.log(`   ✅ Success! ${negativeCount}/5 fields have -1 values`);
      } else {
        console.log(`   ❌ Unexpected failure: ${response.data.error.message}`);
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`   ❌ Still returning 404 - fix not working properly`);
      } else {
        console.log(`   ⚠️  Error: ${error.response?.data?.error?.message || error.message}`);
      }
    }
    
    console.log(''); // Add spacing between tests
  }
}

// Run the tests
async function runTests() {
  await testNegativeOneResponse();
  console.log('\n' + '='.repeat(50) + '\n');
  await testMultipleScenarios();
}

runTests().catch(console.error);
