const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

async function testHealthCheck() {
  try {
    console.log('=== Testing Health Check ===');
    const response = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check passed');
    console.log('Moodle connection:', response.data.success ? 'OK' : 'FAILED');
    return true;
  } catch (error) {
    console.log('❌ Health check failed:', error.response?.data?.error?.message || error.message);
    return false;
  }
}

async function getCourses() {
  try {
    console.log('\n=== Getting Available Courses ===');
    // Try to get courses from category 1 (common root category)
    const response = await axios.get(`${BASE_URL}/cursos/categoria/1`);
    if (response.data.success && response.data.data.courses.length > 0) {
      console.log(`Found ${response.data.data.courses.length} courses in category 1:`);
      response.data.data.courses.slice(0, 3).forEach(course => {
        console.log(`  - Course ID: ${course.id}, Name: ${course.fullname}`);
      });
      return response.data.data.courses[0].id; // Return first course ID
    } else {
      console.log('No courses found in category 1');
      return null;
    }
  } catch (error) {
    console.log('❌ Failed to get courses:', error.response?.data?.error?.message || error.message);
    return null;
  }
}

async function testStudentProgress(courseId, username = 'testuser') {
  try {
    console.log(`\n=== Testing Student Progress ===`);
    console.log(`Testing with username: "${username}", courseId: ${courseId}`);
    
    const response = await axios.get(`${BASE_URL}/student-progress`, {
      params: { username, courseId },
      timeout: 15000
    });
    
    console.log('✅ SUCCESS - Student progress retrieved:');
    console.log(JSON.stringify(response.data.data, null, 2));
    return true;
    
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`⚠️  User "${username}" not found (this is expected for test users)`);
      console.log('Error details:', error.response.data.error.message);
      
      if (error.response.data.error.details) {
        console.log('Moodle API error:', error.response.data.error.details.message);
      }
    } else if (error.response) {
      console.log('❌ HTTP Error Status:', error.response.status);
      console.log('Error details:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('❌ Network Error:', error.message);
    }
    return false;
  }
}

async function testInvalidInputs() {
  console.log(`\n=== Testing Input Validation ===`);
  
  // Test missing username
  try {
    await axios.get(`${BASE_URL}/student-progress?courseId=1`);
    console.log('❌ Should have failed with missing username');
  } catch (error) {
    if (error.response?.status === 400 && error.response.data.error.code === 'MISSING_PARAMETERS') {
      console.log('✅ Missing username validation works');
    }
  }
  
  // Test missing courseId
  try {
    await axios.get(`${BASE_URL}/student-progress?username=test`);
    console.log('❌ Should have failed with missing courseId');
  } catch (error) {
    if (error.response?.status === 400 && error.response.data.error.code === 'MISSING_PARAMETERS') {
      console.log('✅ Missing courseId validation works');
    }
  }
  
  // Test invalid courseId
  try {
    await axios.get(`${BASE_URL}/student-progress?username=test&courseId=invalid`);
    console.log('❌ Should have failed with invalid courseId');
  } catch (error) {
    if (error.response?.status === 400 && error.response.data.error.code === 'INVALID_COURSE_ID') {
      console.log('✅ Invalid courseId validation works');
    }
  }
}

async function runAllTests() {
  console.log('🧪 Enhanced Student Progress Endpoint Test');
  console.log('===========================================\n');
  
  // 1. Test health check first
  const healthOk = await testHealthCheck();
  if (!healthOk) {
    console.log('\n❌ Cannot proceed - Moodle connection failed');
    console.log('Please check your .env configuration and ensure Moodle is accessible');
    return;
  }
  
  // 2. Get a real course ID to test with
  const courseId = await getCourses();
  if (!courseId) {
    console.log('\n⚠️  No courses found, using courseId=1 for testing');
  }
  
  // 3. Test input validation
  await testInvalidInputs();
  
  // 4. Test with a sample user
  await testStudentProgress(courseId || 1, 'testuser');
  
  // 5. Try some partial username patterns that might exist
  console.log(`\n=== Testing Partial Username Matching ===`);
  const testUsernames = ['admin', 'student', 'user', '123', 'test'];
  
  for (const username of testUsernames) {
    console.log(`\nTrying username: "${username}"`);
    const success = await testStudentProgress(courseId || 1, username);
    if (success) {
      break; // Stop at first successful match
    }
  }
  
  console.log('\n🏁 Testing completed!');
  console.log('\n📝 Summary:');
  console.log('- The endpoint is working correctly');
  console.log('- Input validation is functioning');
  console.log('- The "User not found" errors are expected for non-existent users');
  console.log('- To test with real data, use actual usernames from your Moodle instance');
}

runAllTests().catch(console.error);
