const axios = require('axios');

async function testSpecificUser() {
  const userId = 15635;
  const courseId = 330;
  
  console.log('🔍 Debugging User ID 15635 in Course 330');
  console.log('==========================================\n');

  try {
    // First, let's try to find the username for this user ID
    console.log('Step 1: Finding username for user ID', userId);
    
    // Let's test the endpoint with a direct user lookup
    console.log('Testing endpoint with various usernames that might match user ID 15635...\n');
    
    const testUsernames = ['15635', 'user15635', '15635-0'];
    
    for (const testUsername of testUsernames) {
      console.log(`📋 Testing username: "${testUsername}"`);
      
      try {
        const response = await axios.get('http://localhost:3000/api/student-progress', {
          params: {
            username: testUsername,
            courseId: courseId
          },
          timeout: 20000 // Longer timeout for debugging
        });
        
        console.log('✅ Response received!');
        console.log('📊 Response data:');
        console.log(JSON.stringify(response.data, null, 2));
        
        // If we found the user, let's analyze the response
        if (response.data.success && response.data.data) {
          const data = response.data.data;
          console.log('\n📈 Analysis:');
          console.log(`- Username: ${data.username}`);
          console.log(`- Complete Name: ${data.completeName || 'Not available'}`);
          console.log(`- Progress Percentage: ${data.progressPercentage}`);
          console.log(`- Theoretical Grade: ${data.theoreticalGrade}`);
          console.log(`- Practical Grade: ${data.practicalGrade}`);
          console.log(`- Final Grade: ${data.finalGrade}`);
          
          if (data.progressPercentage !== -1 || data.theoreticalGrade !== -1 || data.practicalGrade !== -1 || data.finalGrade !== -1) {
            console.log('\n🎉 SUCCESS: Found real grade data for this user!');
            return; // Stop testing other usernames
          } else {
            console.log('\n⚠️  All grades are -1, but user was found. Check server logs for Moodle API details.');
          }
        }
        
      } catch (error) {
        if (error.response) {
          console.log(`❌ HTTP ${error.response.status}: ${error.response.data?.error?.message || 'Unknown error'}`);
        } else {
          console.log(`❌ Network Error: ${error.message}`);
        }
      }
      
      console.log('─'.repeat(50));
    }
    
    console.log('\n🔧 Debugging Tips:');
    console.log('1. Check the server console logs for detailed Moodle API responses');
    console.log('2. The Moodle logs will show exactly what data is returned from the grade functions');
    console.log('3. Verify in Moodle admin that these web service functions are enabled:');
    console.log('   - gradereport_user_get_grade_items');
    console.log('   - core_grades_get_grades (alternative)');
    console.log('   - core_completion_get_course_completion_status');
    console.log('   - core_completion_get_activities_completion_status');
    
  } catch (error) {
    console.error('💥 Unexpected error:', error.message);
  }
}

async function testDirectMoodleAPI() {
  console.log('\n🌐 Direct Moodle API Test');
  console.log('=========================');
  
  // Read from .env or use the values from the example
  const MOODLE_BASE_URL = 'https://cursos.educampus.cl';
  const MOODLE_TOKEN = '7fd311f07645b3d5f9744edc7b963574'; // From your .env.example
  
  const testCases = [
    {
      name: 'Get User by ID',
      url: `${MOODLE_BASE_URL}/webservice/rest/server.php`,
      params: {
        wstoken: MOODLE_TOKEN,
        wsfunction: 'core_user_get_users',
        moodlewsrestformat: 'json',
        'criteria[0][key]': 'id',
        'criteria[0][value]': '15635'
      }
    },
    {
      name: 'Get Grades for User 15635',
      url: `${MOODLE_BASE_URL}/webservice/rest/server.php`,
      params: {
        wstoken: MOODLE_TOKEN,
        wsfunction: 'gradereport_user_get_grade_items',
        moodlewsrestformat: 'json',
        courseid: '330',
        userid: '15635'
      }
    },
    {
      name: 'Alternative: Get Grades via core_grades_get_grades',
      url: `${MOODLE_BASE_URL}/webservice/rest/server.php`,
      params: {
        wstoken: MOODLE_TOKEN,
        wsfunction: 'core_grades_get_grades',
        moodlewsrestformat: 'json',
        courseid: '330',
        'userids[0]': '15635'
      }
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📋 ${testCase.name}`);
    console.log('URL:', testCase.url);
    console.log('Params:', JSON.stringify(testCase.params, null, 2));
    
    try {
      const response = await axios.get(testCase.url, {
        params: testCase.params,
        timeout: 15000
      });
      
      console.log('✅ Response:', JSON.stringify(response.data, null, 2));
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ HTTP ${error.response.status}:`, JSON.stringify(error.response.data, null, 2));
      } else {
        console.log(`❌ Network Error:`, error.message);
      }
    }
    
    console.log('─'.repeat(60));
  }
}

async function runDebugging() {
  await testSpecificUser();
  
  console.log('\n' + '='.repeat(80));
  
  // Uncomment the line below if you want to test direct Moodle API calls
  // await testDirectMoodleAPI();
  
  console.log('\n📝 Next Steps:');
  console.log('1. Check your server console for detailed Moodle API logs');
  console.log('2. If grades are still -1, the issue is likely:');
  console.log('   - Web service function not enabled in Moodle');
  console.log('   - User permissions insufficient');
  console.log('   - User not enrolled in the specific course');
  console.log('   - Grade structure different than expected');
}

runDebugging().catch(console.error);
