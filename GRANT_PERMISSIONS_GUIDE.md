# How to Grant Permissions to Your Web Service User in Moodle

## Step 1: Identify Your Web Service User

First, you need to know which user account is associated with your web service token.

### Method A: Check Web Service Tokens
1. Log into Moodle as **Administrator**
2. Go to **Site administration** → **Server** → **Web services** → **Manage tokens**
3. Find your token (`7fd311f07645b3d5f9744edc7b963574`)
4. Note the **User** column - this shows which user account the token belongs to

### Method B: If you created the token yourself
- The token is usually associated with your admin account or a dedicated web service user

## Step 2: Grant System-Level Permissions

### Option A: Using Site Administrator Role (Recommended)

1. Go to **Site administration** → **Users** → **Permissions** → **Assign system roles**
2. Click on **Manager** or **Site Administrator**
3. In the **Potential users** section, search for your web service user
4. Select the user and click **Add** to assign them the role

**This gives the user all necessary permissions automatically.**

### Option B: Create Custom Role (More Secure)

If you prefer a more restrictive approach:

1. **Create a Custom Role:**
   - Go to **Site administration** → **Users** → **Permissions** → **Define roles**
   - Click **Add a new role**
   - Choose **Use role or archetype** → **Manager** as starting point
   - Name it "Web Service User" or similar

2. **Configure Role Permissions:**
   - Search for and **Allow** these capabilities:
     ```
     moodle/grade:view
     moodle/grade:viewall  
     moodle/grade:viewhidden
     gradereport/user:view
     gradereport/overview:view
     moodle/user:viewalldetails
     moodle/user:viewhiddendetails
     moodle/site:viewuseridentity
     moodle/course:view
     moodle/course:viewhiddencourses
     moodle/course:viewparticipants
     report/completion:view
     ```
   - Click **Create this role**

3. **Assign the Custom Role:**
   - Go to **Site administration** → **Users** → **Permissions** → **Assign system roles**
   - Click on your new "Web Service User" role
   - Add your web service user to this role

## Step 3: Grant Course-Level Permissions (If Needed)

If system-level permissions don't work, grant course-specific permissions:

### For Specific Courses:
1. Navigate to the course (e.g., course ID 330)
2. Go to course **Settings** → **Users** → **Enrolled users**
3. Click **Enrol users**
4. Search for your web service user
5. Select **Role**: **Teacher** or **Manager**
6. Click **Enrol selected users and cohorts**

### For All Courses:
1. Go to **Site administration** → **Users** → **Permissions** → **Assign system roles**
2. Click **Manager** or create a role with course access permissions
3. Assign your web service user to this role

## Step 4: Verify Permissions

### Test User Lookup
Use this URL in your browser (replace `YOUR_TOKEN` with your actual token):
```
https://cursos.educampus.cl/webservice/rest/server.php?wstoken=YOUR_TOKEN&wsfunction=core_user_get_users&moodlewsrestformat=json&criteria[0][key]=id&criteria[0][value]=15635
```

**Expected Result:** Should return user data for user ID 15635

### Test Grade Access
```
https://cursos.educampus.cl/webservice/rest/server.php?wstoken=YOUR_TOKEN&wsfunction=gradereport_user_get_grade_items&moodlewsrestformat=json&courseid=330&userid=15635
```

**Expected Result:** Should return grade data, not an error

## Step 5: Common Permission Issues

### Issue: "Access denied" Error
**Cause:** User lacks required capabilities
**Solution:** 
- Assign **Manager** or **Site Administrator** role
- Or grant specific capabilities listed in Step 2

### Issue: Empty Grade Response
**Cause:** User can access the function but not the specific course/user
**Solution:**
- Enrol the web service user in the specific course as **Teacher**
- Or assign system-level **Manager** role

### Issue: "Function not available"
**Cause:** Web service function not enabled (different from permissions)
**Solution:**
- Go to **Site administration** → **Server** → **Web services** → **External services**
- Add the missing functions to your service

## Step 6: Quick Permission Test

### Minimal Test Setup:
1. **Assign your web service user the "Manager" role at system level**
2. This should give access to all courses and all grade data
3. Test the API endpoint again

### Commands to Test:
```bash
# In your project directory
node debug-user-15635.js
```

Look at the server console logs for detailed Moodle API responses.

## Step 7: Alternative Approach - Use Admin Token

If you're still having issues, temporarily use an admin user's token:

1. Go to **Site administration** → **Server** → **Web services** → **Manage tokens**
2. Create a new token for your admin account
3. Update your `.env` file with the admin token
4. Test the API endpoint
5. If it works, the issue was permissions; if not, it's a different configuration issue

## Troubleshooting Checklist

- [ ] Web service user has Manager or Site Administrator role
- [ ] Web service functions are added to External Service
- [ ] User exists and has grades in the specific course
- [ ] Grades are not hidden in the gradebook
- [ ] Course completion tracking is enabled
- [ ] Web service token is valid and not expired

## Expected Outcome

After granting proper permissions, your debug script should show:
- Server logs with successful Moodle API responses
- Actual grade data instead of -1 values
- User progress information populated correctly

The most common solution is to assign your web service user the **Manager** role at the system level, which provides comprehensive access to user and grade data across all courses.
