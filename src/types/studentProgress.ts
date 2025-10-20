export interface StudentProgress {
  username: string;
  completeName?: string; // User's full name from Moodle or local database
  courseId: number;
  progressPercentage: number; // Progress Percentage (can be -1 if unavailable)
  studentAttendancePercentage: number; // Student Attendance Percentage (can be -1 if unavailable)
  theoreticalGrade: number; // Theoretical Grade (can be -1 if unavailable)
  theoreticalStatus: 'Passed' | 'Failed' | 'Pending'; // Theoretical Status (Passed or not)
  practicalGrade: number; // Practical Grade (can be -1 if unavailable)
  practicalStatus: 'Passed' | 'Failed' | 'Pending'; // Practical Status (Passed or not)
  finalGrade: number; // Final Grade (can be -1 if unavailable)
  courseStatus: 'Passed' | 'Failed' | 'Pending'; // Course Status (Passed or not)
  observation?: string; // Observation
}

export interface StudentProgressRequest {
  username: string;
  courseId: number;
}

export interface StudentProgressResponse {
  success: boolean;
  data?: StudentProgress;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}
