# Moodle API Configuration for Student Progress Endpoint

This guide explains what web service functions you need to enable in your Moodle instance to make the student progress endpoint work properly.

## Required Web Service Functions

The new student progress endpoint uses the following Moodle web service functions:

### Core Functions (Already in Use)
These are functions your API proxy already uses:
- ✅ `core_webservice_get_site_info` - For health checks
- ✅ `core_course_get_courses_by_field` - For getting courses by category
- ✅ `core_course_get_categories` - For getting course categories
- ✅ `core_enrol_get_enrolled_users` - For getting enrolled users
- ✅ `core_course_get_contents` - For getting course contents

### New Functions for Student Progress
These are the **NEW** functions you need to enable:

#### 1. User Management Functions
- 🆕 **`core_user_get_users`** - To search and find users by username (supports partial matching)

#### 2. Grading Functions
- 🆕 **`gradereport_user_get_grade_items`** - To get user grades for theoretical, practical, and final grades

#### 3. Course Completion Functions
- 🆕 **`core_completion_get_course_completion_status`** - To get overall course completion status
- 🆕 **`core_completion_get_activities_completion_status`** - To get activity-level completion for progress calculation

## Step-by-Step Moodle Configuration

### 1. Access Moodle Administration
1. Log into your Moodle as an administrator
2. Go to **Site administration** → **Server** → **Web services**

### 2. Enable Web Services (if not already done)
1. Go to **Overview** and ensure web services are enabled
2. Click **Enable web services** if needed

### 3. Create/Configure External Service
1. Go to **External services**
2. Find your existing service or create a new one
3. Click **Add functions** for your service

### 4. Add the New Functions
Add these functions to your external service:

```
core_user_get_users
gradereport_user_get_grade_items
core_completion_get_course_completion_status
core_completion_get_activities_completion_status
```

### 5. Configure User Permissions
Ensure your web service user has the following capabilities:

#### For `core_user_get_users`:
- `moodle/user:viewalldetails` - View user details
- `moodle/user:viewhiddendetails` - View hidden user details
- `moodle/site:viewuseridentity` - View user identity

#### For `gradereport_user_get_grade_items`:
- `moodle/grade:view` - View grades
- `moodle/grade:viewall` - View all grades
- `gradereport/user:view` - View user grade report

#### For completion functions:
- `moodle/course:viewhiddencourses` - View hidden courses
- `report/completion:view` - View completion reports

### 6. Update Web Service Token Permissions
1. Go to **Manage tokens**
2. Find your token and ensure it has access to the updated external service
3. Verify the token user has all necessary capabilities

## Testing the Configuration

After enabling the functions, you can test them individually:

### Test User Search
```bash
curl "https://your-moodle.com/webservice/rest/server.php?wstoken=YOUR_TOKEN&wsfunction=core_user_get_users&moodlewsrestformat=json&criteria[0][key]=username&criteria[0][value]=testuser"
```

### Test Grade Retrieval
```bash
curl "https://your-moodle.com/webservice/rest/server.php?wstoken=YOUR_TOKEN&wsfunction=gradereport_user_get_grade_items&moodlewsrestformat=json&courseid=1&userid=2"
```

### Test Course Completion
```bash
curl "https://your-moodle.com/webservice/rest/server.php?wstoken=YOUR_TOKEN&wsfunction=core_completion_get_course_completion_status&moodlewsrestformat=json&courseid=1&userid=2"
```

## Required Moodle Settings

### 1. Enable Course Completion
For the completion functions to work:
1. Go to **Site administration** → **Advanced features**
2. Enable **Enable completion tracking**
3. For each course, go to **Course administration** → **Course completion**
4. Set up completion criteria

### 2. Enable Grade Categories (Optional but Recommended)
For better theoretical/practical grade separation:
1. Go to course **Gradebook setup**
2. Create categories like "Theoretical" and "Practical"
3. Organize grade items into these categories

### 3. User Field Visibility
Ensure username fields are accessible:
1. Go to **Site administration** → **Users** → **User policies**
2. Configure user field visibility as needed

## Troubleshooting

### Common Issues:

#### 1. "Function not available" Error
- **Cause**: Function not added to external service
- **Solution**: Add the missing function to your external service

#### 2. "Access denied" Error
- **Cause**: User lacks required capabilities
- **Solution**: Grant necessary capabilities to web service user

#### 3. "Invalid token" Error
- **Cause**: Token doesn't have access to updated service
- **Solution**: Regenerate token or update service permissions

#### 4. Empty Results
- **Cause**: User not enrolled in course or completion not enabled
- **Solution**: Check enrollment and enable completion tracking

### Testing with the API Proxy

After configuration, test the endpoint:

```bash
# Test with a known username and course ID
curl "http://localhost:3000/api/student-progress?username=testuser&courseId=1"
```

## Security Considerations

1. **Principle of Least Privilege**: Only grant capabilities actually needed
2. **Token Security**: Keep your web service token secure
3. **User Privacy**: Ensure compliance with privacy policies when accessing user data
4. **Access Logging**: Consider enabling web service logging for audit trails

## Minimum Moodle Version

These functions require:
- **Moodle 3.2+** for completion functions
- **Moodle 3.0+** for grade report functions
- **Moodle 2.2+** for user functions

Most modern Moodle instances should support all required functions.

## Next Steps

1. Enable all the new web service functions in Moodle
2. Test each function individually using the curl commands above
3. Run the student progress endpoint tests: `node test-student-progress.js`
4. Verify the endpoint returns expected data for your users and courses

If you encounter any issues, check the Moodle web service logs and verify that all permissions are correctly configured.
