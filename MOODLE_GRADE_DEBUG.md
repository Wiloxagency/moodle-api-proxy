# Debugging Moodle Grade Access Issues

## Current Issue
- User ID 15635 exists in Moodle and has grades visible in the web interface
- However, the API calls are returning -1 for all grade fields
- This indicates the Moodle web service functions are not returning grade data

## Required Web Service Functions

Add these functions to your External Service in Moodle:

### Primary Grade Function
- `gradereport_user_get_grade_items` - Gets detailed grade report for a user

### Alternative Grade Functions (if primary doesn't work)
- `core_grades_get_grades` - Alternative method to get grades
- `gradereport_overview_get_course_grades` - Overview grade report

### Completion Functions  
- `core_completion_get_course_completion_status` - Course completion status
- `core_completion_get_activities_completion_status` - Activity completion

## Step-by-Step Configuration

### 1. Enable Web Service Functions

1. Go to **Site administration** → **Server** → **Web services** → **External services**
2. Find your external service and click **Functions**
3. Add these functions:
   ```
   gradereport_user_get_grade_items
   core_grades_get_grades
   gradereport_overview_get_course_grades
   core_completion_get_course_completion_status
   core_completion_get_activities_completion_status
   ```

### 2. Check User Permissions

Your web service user needs these capabilities:

**Grade-related capabilities:**
- `moodle/grade:view` - View grades
- `moodle/grade:viewall` - View all grades  
- `moodle/grade:viewhidden` - View hidden grades
- `gradereport/user:view` - View user grade report
- `gradereport/overview:view` - View overview grade report

**User-related capabilities:**
- `moodle/user:viewalldetails` - View user details
- `moodle/course:viewparticipants` - View course participants

**Course-related capabilities:**
- `moodle/course:view` - View courses
- `moodle/course:viewhiddencourses` - View hidden courses

### 3. Test Individual Functions

Test each function directly via URL:

#### Test User Lookup
```
https://cursos.educampus.cl/webservice/rest/server.php?wstoken=YOUR_TOKEN&wsfunction=core_user_get_users&moodlewsrestformat=json&criteria[0][key]=id&criteria[0][value]=15635
```

#### Test Primary Grade Function
```
https://cursos.educampus.cl/webservice/rest/server.php?wstoken=YOUR_TOKEN&wsfunction=gradereport_user_get_grade_items&moodlewsrestformat=json&courseid=330&userid=15635
```

#### Test Alternative Grade Function
```
https://cursos.educampus.cl/webservice/rest/server.php?wstoken=YOUR_TOKEN&wsfunction=core_grades_get_grades&moodlewsrestformat=json&courseid=330&userids[0]=15635
```

### 4. Common Issues and Solutions

#### Issue: "Function not available"
**Cause:** Function not added to external service
**Solution:** Add the function to your external service

#### Issue: "Access denied" or empty response
**Cause:** Insufficient permissions
**Solution:** Grant the required capabilities to your web service user

#### Issue: "User not enrolled"
**Cause:** User might not be enrolled in the course
**Solution:** Check enrollment in Moodle admin or course participants

#### Issue: "Invalid course/user ID"
**Cause:** IDs don't exist or are inaccessible
**Solution:** Verify IDs in Moodle database

### 5. Alternative Approach: Use Username Instead of User ID

If the user ID approach doesn't work, we can modify the code to:
1. Find the user by username first
2. Get their user ID from the response  
3. Then fetch grades using that ID

### 6. Check Gradebook Setup

In Moodle course gradebook:
1. Verify grades are published (not hidden)
2. Check gradebook categories are set up correctly
3. Ensure grade items have proper names for our parsing logic

### 7. Server Logs Analysis

Check your server console logs when testing. The logs will show:
- Exact API URLs being called
- Full responses from Moodle
- Any error messages or empty responses

Look for these patterns in the logs:
```javascript
// Successful grade retrieval
"Primary grades result": {
  "success": true,
  "data": {
    "usergrades": [...] // Should contain grade data
  }
}

// Failed grade retrieval
"Primary grades result": {
  "success": false,
  "error": {...}
}

// Empty grade data
"Primary grades result": {
  "success": true,
  "data": [] // Empty or null
}
```

### 8. Testing Commands

Run these to debug:

```bash
# Test the specific user
node debug-user-15635.js

# Check server logs while running the test
npm run dev
```

### 9. Expected Grade Data Structure

The Moodle grade functions should return data like:
```json
{
  "usergrades": [
    {
      "userid": 15635,
      "courseid": 330,
      "gradeitems": [
        {
          "id": 1234,
          "itemname": "Final Exam",
          "itemtype": "mod",
          "graderaw": 85.5,
          "gradeformatted": "85.50",
          "grademin": 0,
          "grademax": 100
        }
      ]
    }
  ]
}
```

If you're seeing empty arrays or null values, the issue is with permissions or function availability.

## Next Steps

1. **Check Moodle Configuration:** Add the required functions and permissions
2. **Test Individual Functions:** Use the direct URL tests above  
3. **Check Server Logs:** Look for detailed API response logs
4. **Verify User Enrollment:** Ensure user 15635 is enrolled in course 330
5. **Contact Moodle Admin:** If needed, verify web service configuration with your Moodle administrator
