import axios, { AxiosResponse } from 'axios';
import { config } from '../config/environment';
import { 
  MoodleWebServiceParams, 
  MoodleWebServiceFullParams,
  MoodleCoursesResponse,
  MoodleCategoriesResponse,
  MoodleCategoriesApiResponse,
  MoodleErrorResponse,
  SimplifiedCoursesResponse,
  SimplifiedCourse,
  ApiResponse 
} from '../types/moodle';

export class MoodleService {
  private readonly baseUrl: string;
  private readonly wsToken: string;
  private readonly webserviceEndpoint: string;

  constructor() {
    this.baseUrl = config.moodle.baseUrl;
    this.wsToken = config.moodle.wsToken;
    this.webserviceEndpoint = config.moodle.webserviceEndpoint;
  }

  private buildUrl(params: MoodleWebServiceFullParams): string {
    const url = new URL(this.webserviceEndpoint, this.baseUrl);

    // Add all parameters to URL
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value.toString());
    });

    return url.toString();
  }

  private async makeRequest<T>(params: MoodleWebServiceParams): Promise<ApiResponse<T>> {
    try {
    const fullParams = this.addDefaultParams(params);
    const url = this.buildUrl(fullParams);
      
      const response: AxiosResponse<T | MoodleErrorResponse> = await axios.get(url, {
        timeout: 10000, // 10 seconds timeout
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Moodle-API-Proxy/1.0'
        }
      });

      // Check if response is an error
      if (this.isMoodleError(response.data)) {
        return {
          success: false,
          error: {
            message: response.data.message,
            code: response.data.errorcode,
            details: response.data
          }
        };
      }

      return {
        success: true,
        data: response.data as T
      };

    } catch (error) {
      console.error('Moodle API request failed:', error);
      
      if (axios.isAxiosError(error)) {
        return {
          success: false,
          error: {
            message: error.message,
            code: error.code,
            details: error.response?.data
          }
        };
      }

      return {
        success: false,
        error: {
          message: 'Unknown error occurred',
          details: error
        }
      };
    }
  }

  private isMoodleError(data: any): data is MoodleErrorResponse {
    return data && typeof data === 'object' && 'exception' in data && 'errorcode' in data;
  }

  private addDefaultParams(params: MoodleWebServiceParams): MoodleWebServiceFullParams {
    return {
      ...params,
      wstoken: this.wsToken,
      moodlewsrestformat: 'json'
    };
  }

  /**
   * Get courses by category ID
   */
  async getCoursesByCategory(categoryId: number): Promise<ApiResponse<MoodleCoursesResponse>> {
    return this.makeRequest<MoodleCoursesResponse>({
      wsfunction: 'core_course_get_courses_by_field',
      field: 'category',
      value: categoryId.toString()
    });
  }

  /**
   * Get courses by any field
   */
  async getCoursesByField(field: string, value: string): Promise<ApiResponse<MoodleCoursesResponse>> {
    return this.makeRequest<MoodleCoursesResponse>({
      wsfunction: 'core_course_get_courses_by_field',
      field,
      value
    });
  }

  /**
   * Get all categories (optionally filtered by parent)
   */
  async getCategories(parentId?: number): Promise<ApiResponse<MoodleCategoriesApiResponse>> {
    const params: MoodleWebServiceParams = {
      wsfunction: 'core_course_get_categories'
    };

    // Add criteria to filter by parent if specified
    if (parentId !== undefined) {
      params['criteria[0][key]'] = 'parent';
      params['criteria[0][value]'] = parentId.toString();
    }

    const result = await this.makeRequest<MoodleCategoriesResponse>(params);
    
    // Transform the direct array response into our expected format
    if (result.success && Array.isArray(result.data)) {
      let filteredCategories = result.data;
      
      // If parentId is specified, filter the results (since Moodle might not always respect criteria)
      if (parentId !== undefined) {
        filteredCategories = result.data.filter(category => category.parent === parentId);
      }
      
      return {
        success: true,
        data: {
          categories: filteredCategories,
          warnings: []
        }
      };
    }
    
    return {
      success: result.success,
      error: result.error
    };
  }

  /**
   * Get root categories (parent = 0)
   */
  async getRootCategories(): Promise<ApiResponse<MoodleCategoriesApiResponse>> {
    return this.getCategories(0);
  }

  /**
   * Get enrollment count for a specific course
   */
  async getCourseEnrollmentCount(courseId: number): Promise<number> {
    try {
      // Fetch all enrolled users and count only active ones
      const usersResult = await this.makeRequest<any[]>({
        wsfunction: "core_enrol_get_enrolled_users",
        courseid: courseId.toString(),
        'options[0][name]': 'onlyactive',
        'options[0][value]': '1'
      });

      if (usersResult.success && Array.isArray(usersResult.data)) {
        const now = Math.floor(Date.now() / 1000);
        const activeUsers = usersResult.data.filter((u: any) => {
  const suspended = (u as any).suspended;
  const isSuspended = suspended === true || suspended === 1 || suspended === '1';

  // Consider only students; if roles missing, don't exclude
  const roles = (u as any).roles;
  const isStudentRole = Array.isArray(roles)
    ? roles.some((r: any) => {
        const sn = String(r?.shortname ?? '').toLowerCase();
        const archetype = String(r?.archetype ?? '').toLowerCase();
        return r?.roleid === 5 || sn === 'student' || sn === 'estudiante' || sn === 'alumno' || archetype === 'student';
      })
    : true;

  // If enrolment records exist, require at least one active enrolment (status === 0);
  // otherwise assume active (we already requested onlyactive=1).
  let hasActiveEnrolment = true;
  const enrolments = (u as any).enrolments;
  if (Array.isArray(enrolments) && enrolments.length > 0) {
    hasActiveEnrolment = enrolments.some((e: any) => {
      const eStatus = e?.status;
      const isActiveStatus = eStatus === 0 || eStatus === '0';
      const eCourseMatch = e?.courseid == null || e?.courseid === courseId;
      return eCourseMatch && isActiveStatus;
    });
  }

  return !isSuspended && isStudentRole && hasActiveEnrolment;
});

        return activeUsers.length;
      }

      return 0;
    } catch (error) {
      console.warn("Failed to get enrollment count for course " + courseId + ":", error);
      return 0; // Return 0 on error to avoid breaking the response
    }
  }

  /**
   * Get simplified courses by category ID
   */
  async getSimplifiedCoursesByCategory(categoryId: number): Promise<ApiResponse<SimplifiedCoursesResponse>> {
    // First get the full courses data
    const coursesResult = await this.getCoursesByCategory(categoryId);
    
    if (!coursesResult.success || !coursesResult.data) {
      return {
        success: false,
        error: coursesResult.error
      };
    }

    const courses = coursesResult.data.courses;
    
    // Transform courses to simplified format and get enrollment counts
    const simplifiedCoursesPromises = courses.map(async (course) => {
      const studentCount = await this.getCourseEnrollmentCount(course.id);
      
      return {
        id: course.id,
        fullname: course.fullname,
        startdate: course.startdate,
        enddate: course.enddate,
        students: studentCount
      } as SimplifiedCourse;
    });

    try {
      const simplifiedCourses = await Promise.all(simplifiedCoursesPromises);
      
      return {
        success: true,
        data: {
          courses: simplifiedCourses,
          warnings: coursesResult.data.warnings
        }
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: 'Failed to get enrollment counts for courses',
          details: error
        }
      };
    }
  }

  /**
   * Get user by username (supports partial matching)
   */
  async getUserByUsername(username: string): Promise<ApiResponse<any[]>> {
    return this.makeRequest<any[]>({
      wsfunction: 'core_user_get_users',
      'criteria[0][key]': 'username',
      'criteria[0][value]': username
    });
  }

  /**
   * Search users by partial username
   */
  async searchUsersByPartialUsername(partialUsername: string): Promise<ApiResponse<any[]>> {
    return this.makeRequest<any[]>({
      wsfunction: 'core_user_get_users',
      'criteria[0][key]': 'username',
      'criteria[0][value]': `%${partialUsername}%`
    });
  }

  /**
   * Get enrolled users for a specific course
   */
  async getEnrolledUsers(courseId: number): Promise<ApiResponse<any[]>> {
    return this.makeRequest<any[]>({
      wsfunction: 'core_enrol_get_enrolled_users',
      courseid: courseId.toString()
    });
  }

  /**
   * Get users by field using exact matching (username, idnumber, email, id)
   */
  async getUsersByField(field: 'id' | 'idnumber' | 'username' | 'email', value: string): Promise<ApiResponse<any[]>> {
    return this.makeRequest<any[]>({
      wsfunction: 'core_user_get_users_by_field',
      field,
      'values[0]': value
    });
  }

  /**
   * Update Moodle user profile fields
   */
  async updateUser(user: {
    id: number;
    firstname?: string;
    lastname?: string;
    email?: string;
    username?: string;
    idnumber?: string;
    phone1?: string;
  }): Promise<ApiResponse<any>> {
    const params: MoodleWebServiceParams = {
      wsfunction: 'core_user_update_users',
      'users[0][id]': user.id.toString()
    };

    if (user.firstname !== undefined) params['users[0][firstname]'] = user.firstname;
    if (user.lastname !== undefined) params['users[0][lastname]'] = user.lastname;
    if (user.email !== undefined) params['users[0][email]'] = user.email;
    if (user.username !== undefined) params['users[0][username]'] = user.username;
    if (user.idnumber !== undefined) params['users[0][idnumber]'] = user.idnumber;
    if (user.phone1 !== undefined) params['users[0][phone1]'] = user.phone1;

    return this.makeRequest<any>(params);
  }

  /**
   * Create a Moodle user account
   */
  async createUser(user: {
    username: string;
    firstname: string;
    lastname: string;
    email: string;
    password: string;
    auth?: string;
    idnumber?: string;
    phone1?: string;
  }): Promise<ApiResponse<any>> {
    const params: MoodleWebServiceParams = {
      wsfunction: 'core_user_create_users',
      'users[0][username]': user.username,
      'users[0][firstname]': user.firstname,
      'users[0][lastname]': user.lastname,
      'users[0][email]': user.email,
      'users[0][password]': user.password
    };

    if (user.auth !== undefined) params['users[0][auth]'] = user.auth;
    if (user.idnumber !== undefined) params['users[0][idnumber]'] = user.idnumber;
    if (user.phone1 !== undefined) params['users[0][phone1]'] = user.phone1;

    const result = await this.makeRequest<any>(params);
    if (!result.success) return result;

    const createdArray = Array.isArray(result.data) ? result.data : [];
    return {
      success: true,
      data: createdArray[0] || null
    };
  }

  /**
   * Enroll one user into a course with a role (student role by default)
   */
  async enrollUser(courseId: number, userId: number, roleId: number = 5): Promise<ApiResponse<any>> {
    return this.makeRequest<any>({
      wsfunction: 'enrol_manual_enrol_users',
      'enrolments[0][roleid]': roleId.toString(),
      'enrolments[0][userid]': userId.toString(),
      'enrolments[0][courseid]': courseId.toString()
    });
  }

  /**
   * Get user grades for a specific course
   */
  async getUserGrades(courseId: number, userId: number): Promise<ApiResponse<any>> {
    console.log(`Getting grades for user ${userId} in course ${courseId}`);
    
    // Try the primary grade report function first
    let result = await this.makeRequest<any>({
      wsfunction: 'gradereport_user_get_grade_items',
      courseid: courseId.toString(),
      userid: userId.toString()
    });
    
    console.log('Primary grades result:', JSON.stringify(result, null, 2));
    
    // If that fails, try alternative grade functions
    if (!result.success) {
      console.log('Trying alternative grade function: core_grades_get_grades');
      result = await this.makeRequest<any>({
        wsfunction: 'core_grades_get_grades',
        courseid: courseId.toString(),
        'userids[0]': userId.toString()
      });
      console.log('Alternative grades result:', JSON.stringify(result, null, 2));
    }
    
    return result;
  }

  /**
   * Get all grade items for a course
   */
  async getCourseGradeItems(courseId: number): Promise<ApiResponse<any>> {
    console.log(`Getting grade items for course ${courseId}`);
    const result = await this.makeRequest<any>({
      wsfunction: 'core_course_get_contents',
      courseid: courseId.toString(),
      'options[0][name]': 'includestealthmodules',
      'options[0][value]': '1'
    });
    console.log('Course contents result:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Cuestionarios de un curso (mod_quiz_get_quizzes_by_courses).
   *
   * Útil cuando `core_course_get_contents` no está permitido para el token
   * (responde `accessexception`) pero sí lo está el WS de mod_quiz.
   *
   * Respuesta: { quizzes: [{ id, coursemodule, course, name, ... }] }
   * Ojo: en esa respuesta `id` es el quizid (instance) y `coursemodule` el cmid.
   */
  async getCourseQuizzes(courseId: number): Promise<ApiResponse<any>> {
    return this.makeRequest<any>({
      wsfunction: 'mod_quiz_get_quizzes_by_courses',
      'courseids[0]': courseId.toString()
    });
  }

  /**
   * Mejor nota de un alumno en un cuestionario (mod_quiz).
   *
   * Se usa como respaldo cuando el ítem no aparece en el libro de notas
   * (por ejemplo, cuando está oculto en el gradebook y el token no tiene la
   * capacidad `moodle/grade:viewhidden`).
   *
   * Requiere que `mod_quiz_get_user_best_grade` esté habilitado en el
   * External Service de Moodle. Si no lo está, devuelve success:false y el
   * llamador simplemente no aplica el respaldo.
   *
   * Respuesta: { hasgrade: boolean, grade?: number }
   */
  async getQuizUserBestGrade(quizId: number, userId: number): Promise<ApiResponse<any>> {
    return this.makeRequest<any>({
      wsfunction: 'mod_quiz_get_user_best_grade',
      quizid: quizId.toString(),
      userid: userId.toString()
    });
  }

  /**
   * Get course completion status for a user
   */
  async getCourseCompletion(courseId: number, userId: number): Promise<ApiResponse<any>> {
    return this.makeRequest<any>({
      wsfunction: 'core_completion_get_course_completion_status',
      courseid: courseId.toString(),
      userid: userId.toString()
    });
  }

  /**
   * Get activities completion status for a user in a course
   */
  async getActivitiesCompletion(courseId: number, userId: number): Promise<ApiResponse<any[]>> {
    return this.makeRequest<any[]>({
      wsfunction: 'core_completion_get_activities_completion_status',
      courseid: courseId.toString(),
      userid: userId.toString()
    });
  }

  /**
   * Get user progress in a course (comprehensive method)
   */
  async getUserProgressInCourse(username: string, courseId: number): Promise<ApiResponse<any>> {
    try {
      console.log(`=== Getting user progress for username: ${username}, courseId: ${courseId} ===`);
      
      // First, try to find the user by exact username
      console.log('Step 1: Trying exact username match...');
      let userResult = await this.getUserByUsername(username);
      console.log('Exact match result:', userResult.success ? `Found ${userResult.data?.length} users` : 'Failed');
      
      // If no exact match found, try partial matching
      if (!userResult.success || !userResult.data || userResult.data.length === 0) {
        console.log('Step 2: Trying partial username match...');
        userResult = await this.searchUsersByPartialUsername(username);
        console.log('Partial match result:', userResult.success ? `Found ${userResult.data?.length} users` : 'Failed');
      }

      if (!userResult.success || !userResult.data || userResult.data.length === 0) {
        console.log('No user found with username:', username);
        return {
          success: false,
          error: {
            message: 'User not found',
            code: 'USER_NOT_FOUND'
          }
        };
      }

      // Find the best match for partial username
      let user = userResult.data[0];
      if (userResult.data.length > 1) {
        console.log(`Multiple users found (${userResult.data.length}), selecting best match...`);
        // Prefer exact matches or those that start with the provided username
        const exactMatch = userResult.data.find(u => u.username === username);
        const startsWithMatch = userResult.data.find(u => u.username.startsWith(username));
        user = exactMatch || startsWithMatch || user;
        console.log('Selected user:', user.username, 'ID:', user.id);
      } else {
        console.log('Found single user:', user.username, 'ID:', user.id);
      }

      const userId = user.id;

      // Get all necessary data in parallel
      console.log('Step 3: Getting grades, completion, and activities data...');
      const [gradesResult, completionResult, activitiesResult] = await Promise.all([
        this.getUserGrades(courseId, userId),
        this.getCourseCompletion(courseId, userId),
        this.getActivitiesCompletion(courseId, userId)
      ]);
      
      console.log('Grades result:', gradesResult.success ? 'Success' : `Failed: ${gradesResult.error?.message}`);
      console.log('Completion result:', completionResult.success ? 'Success' : `Failed: ${completionResult.error?.message}`);
      console.log('Activities result:', activitiesResult.success ? 'Success' : `Failed: ${activitiesResult.error?.message}`);

      console.log('=== User progress retrieval completed ===');
      return {
        success: true,
        data: {
          user,
          grades: gradesResult.success ? gradesResult.data : null,
          completion: completionResult.success ? completionResult.data : null,
          activities: activitiesResult.success ? activitiesResult.data : null
        }
      };

    } catch (error) {
      console.error('=== ERROR in getUserProgressInCourse ===');
      console.error('Error details:', error);
      console.error('=========================================');
      return {
        success: false,
        error: {
          message: 'Failed to get user progress data',
          details: error
        }
      };
    }
  }

  /**
   * Health check - test the connection to Moodle
   */
  async healthCheck(): Promise<ApiResponse<any>> {
    return this.makeRequest({
      wsfunction: 'core_webservice_get_site_info'
    });
  }
}
