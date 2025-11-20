# Student Progress Endpoint

A new endpoint has been added to retrieve comprehensive student progress information from Moodle.

## Endpoint

```
GET /api/student-progress?username=USERNAME&courseId=COURSE_ID
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | Yes | Student username (supports partial matching) |
| `courseId` | number | Yes | Moodle course ID |

## Response Format

### Successful Response (Data Available)
```json
{
  "success": true,
  "data": {
    "username": "student123",
    "completeName": "John Doe Smith",
    "courseId": 123,
    "progressPercentage": 75,
    "studentAttendancePercentage": 80,
    "theoreticalGrade": 5.5,
    "theoreticalStatus": "Passed",
    "practicalGrade": 6.0,
    "practicalStatus": "Passed",
    "finalGrade": 5.8,
    "courseStatus": "Passed",
    "observation": "Student showing good progress"
  }
}
```

### Successful Response (Data Unavailable)
When progress data cannot be retrieved from Moodle, the endpoint returns -1 for all numeric fields:
```json
{
  "success": true,
  "data": {
    "username": "16740465-0",
    "completeName": "NICOLE VARGAS SANDOVAL",
    "courseId": 327,
    "progressPercentage": -1,
    "studentAttendancePercentage": -1,
    "theoreticalGrade": -1,
    "theoreticalStatus": "Pending",
    "practicalGrade": -1,
    "practicalStatus": "Pending",
    "finalGrade": -1,
    "courseStatus": "Pending",
    "observation": null
  }
}
```

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `username` | string | The matched student username |
| `completeName` | string | Student's full name from Moodle or local database |
| `courseId` | number | The course ID |
| `progressPercentage` | number | Overall course progress percentage (0-100, or -1 if unavailable) |
| `studentAttendancePercentage` | number | Attendance percentage (0-100, or -1 if unavailable) |
| `theoreticalGrade` | number | Grade for theoretical components (-1 if unavailable) |
| `theoreticalStatus` | string | "Passed", "Failed", or "Pending" |
| `practicalGrade` | number | Grade for practical components (-1 if unavailable) |
| `practicalStatus` | string | "Passed", "Failed", or "Pending" |
| `finalGrade` | number | Final course grade (-1 if unavailable) |
| `courseStatus` | string | Overall course status: "Passed", "Failed", or "Pending" |
| `observation` | string | Additional observations from local database |

**Note**: When progress data cannot be retrieved from Moodle (due to user not being enrolled, missing permissions, etc.), all numeric fields return -1 and status fields return "Pending".

**Name Data Priority**: The `completeName` field is populated using the following priority:
1. Moodle user's `fullname` field
2. Moodle user's `firstname` + `lastname` fields
3. Local database `nombres` + `apellidos` fields
4. Local database `nombres` field only
5. `undefined`/`null` if no name data is available

## Partial Username Matching

The endpoint supports partial username matching for cases where the input username is incomplete:

- Input: `"45678974"`
- Will match: `"45678974-2"`, `"45678974-A"`, etc.

The matching logic:
1. First tries exact match
2. Then tries partial match (starts with input)
3. Finally tries substring match (contains input)

## Error Responses

### Missing Parameters (400)
```json
{
  "success": false,
  "error": {
    "message": "Both username and courseId parameters are required",
    "code": "MISSING_PARAMETERS"
  }
}
```

### Invalid Course ID (400)
```json
{
  "success": false,
  "error": {
    "message": "courseId must be a valid number",
    "code": "INVALID_COURSE_ID"
  }
}
```

**Note**: The endpoint no longer returns 404 errors for non-existent users. Instead, it returns success responses with -1 values for all numeric fields when data is unavailable.

## Usage Examples

### Basic Request
```bash
curl "http://localhost:3000/api/student-progress?username=student123&courseId=456"
```

### With Partial Username
```bash
curl "http://localhost:3000/api/student-progress?username=45678974&courseId=456"
```

### Using JavaScript/Axios
```javascript
const response = await axios.get('/api/student-progress', {
  params: {
    username: '45678974',
    courseId: 456
  }
});

if (response.data.success) {
  const progress = response.data.data;
  console.log(`Progress: ${progress.progressPercentage}%`);
  console.log(`Status: ${progress.courseStatus}`);
} else {
  console.error('Error:', response.data.error.message);
}
```

## Testing

Use the provided test script to verify the endpoint:

```bash
node test-student-progress.js
```

This will run several test cases including:
- Complete username matching
- Partial username matching
- Error handling for invalid parameters
- Error handling for missing parameters

## Notes

1. **Grade Calculation**: The endpoint assumes a passing grade of 4.0. Adjust the `passingGrade` constant in `StudentProgressController.ts` if your Moodle instance uses a different scale.

2. **Attendance Calculation**: Currently based on completion of attendance-type activities. You may need to adjust the logic based on your specific attendance tracking method.

3. **Grade Categories**: The system looks for grade items with names containing "theoretical", "practical", or "final" keywords. Adjust the matching logic in `processProgressData()` if your grade categories use different naming conventions.

4. **Local Database Integration**: The endpoint can pull additional information (like observations) from your local participant database if a matching record is found.

## Troubleshooting

1. **User Not Found**: Ensure the username exists in Moodle and that the user is enrolled in the specified course.

2. **No Progress Data**: Check that the course has activities and that completion tracking is enabled in Moodle.

3. **Authentication Errors**: Verify that your Moodle web service token has the necessary permissions to access user data, grades, and completion information.

4. **Database Connection**: Ensure MongoDB is running and the connection string in your `.env` file is correct.
