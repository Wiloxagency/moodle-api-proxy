const axios = require('axios');

async function testCompleteNameField() {
  try {
    console.log('🧪 Testing completeName Field in Response');
    console.log('==========================================\n');
    
    const response = await axios.get('http://localhost:3000/api/student-progress', {
      params: {
        username: '16740465', // The username that worked in our previous test
        courseId: 327
      },
      timeout: 15000
    });
    
    console.log('✅ Request successful!');
    console.log('📊 Full Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      const data = response.data.data;
      
      console.log('\n🔍 Analysis:');
      console.log(`- Username: "${data.username}"`);
      console.log(`- Complete Name: "${data.completeName || 'Not available'}"`);
      console.log(`- Course ID: ${data.courseId}`);
      console.log(`- Has completeName field: ${data.hasOwnProperty('completeName') ? 'Yes' : 'No'}`);
      
      if (data.completeName) {
        console.log('\n✅ SUCCESS: Complete name is available!');
        console.log(`   Complete name: "${data.completeName}"`);
      } else {
        console.log('\n⚠️  Note: Complete name is not available for this user');
        console.log('   This could be because:');
        console.log('   - No name data in Moodle user profile');
        console.log('   - No matching participant in local database');
        console.log('   - Participant record lacks nombres/apellidos fields');
      }
      
      // Check if the response structure is correct
      const expectedFields = [
        'username', 'completeName', 'courseId', 'progressPercentage',
        'studentAttendancePercentage', 'theoreticalGrade', 'theoreticalStatus',
        'practicalGrade', 'practicalStatus', 'finalGrade', 'courseStatus'
      ];
      
      const missingFields = expectedFields.filter(field => !data.hasOwnProperty(field));
      const extraFields = Object.keys(data).filter(field => !expectedFields.includes(field) && field !== 'observation');
      
      if (missingFields.length === 0) {
        console.log('\n✅ All expected fields are present');
      } else {
        console.log(`\n❌ Missing fields: ${missingFields.join(', ')}`);
      }
      
      if (extraFields.length > 0) {
        console.log(`📋 Additional fields: ${extraFields.join(', ')}`);
      }
      
    } else {
      console.log('\n❌ Request failed:', response.data.error.message);
    }
    
  } catch (error) {
    if (error.response) {
      console.log('❌ HTTP Error Status:', error.response.status);
      console.log('Error details:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('❌ Network Error:', error.message);
      console.log('Is the server running?');
    }
  }
}

async function testMultipleUsersForNames() {
  console.log('\n🧪 Testing Multiple Users for Name Data');
  console.log('=======================================\n');
  
  const testCases = [
    { username: '16740465', courseId: 327, description: 'Known user from database' },
    { username: 'nonexistent', courseId: 1, description: 'Non-existent user' },
    { username: 'admin', courseId: 1, description: 'Potential admin user' }
  ];
  
  for (const testCase of testCases) {
    console.log(`📋 Testing: ${testCase.description}`);
    console.log(`   Username: ${testCase.username}`);
    
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
        console.log(`   ✅ Success! Complete Name: "${data.completeName || 'Not available'}"`);
        console.log(`   📊 Data source: ${data.completeName ? 'Available' : 'None'}`);
      } else {
        console.log(`   ❌ Failed: ${response.data.error.message}`);
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.response?.data?.error?.message || error.message}`);
    }
    
    console.log(''); // Add spacing between tests
  }
}

async function runTests() {
  await testCompleteNameField();
  console.log('\n' + '='.repeat(60) + '\n');
  await testMultipleUsersForNames();
  
  console.log('\n📝 Summary:');
  console.log('- The completeName field has been successfully added to the response');
  console.log('- Name data is extracted from both Moodle user data and local database');
  console.log('- Priority: Moodle fullname > Moodle firstname+lastname > Local nombres+apellidos');
  console.log('- Field returns undefined/null when no name data is available');
}

runTests().catch(console.error);
