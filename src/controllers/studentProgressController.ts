import { Request, Response } from 'express';
import { MoodleService } from '../services/moodleService';
import { getParticipantesCollection } from '../db/mongo';
import { StudentProgress, StudentProgressResponse } from '../types/studentProgress';
import { Participante } from '../types/participante';

export class StudentProgressController {
  private moodleService: MoodleService;

  constructor() {
    this.moodleService = new MoodleService();
  }

  // GET /api/student-progress?username=45678974&courseId=123
  async getStudentProgress(req: Request, res: Response) {
    const { username, courseId } = req.query as { username?: string; courseId?: string };
    
    try {

      // Validate input parameters
      if (!username || !courseId) {
        const response: StudentProgressResponse = {
          success: false,
          error: {
            message: 'Both username and courseId parameters are required',
            code: 'MISSING_PARAMETERS'
          }
        };
        res.status(400).json(response);
        return;
      }

      const courseIdNum = parseInt(courseId, 10);
      if (isNaN(courseIdNum)) {
        const response: StudentProgressResponse = {
          success: false,
          error: {
            message: 'courseId must be a valid number',
            code: 'INVALID_COURSE_ID'
          }
        };
        res.status(400).json(response);
        return;
      }

      // Get student progress data from Moodle
      const moodleResult = await this.moodleService.getUserProgressInCourse(username, courseIdNum);

      if (!moodleResult.success) {
        // Try partial username matching in local database
        const participant = await this.findParticipantByPartialUsername(username);
        
        if (!participant) {
          // Return -1 values when student is not found anywhere
          const progressData: StudentProgress = {
            username: username,
            completeName: undefined, // No name data available
            courseId: courseIdNum,
            progressPercentage: -1,
            studentAttendancePercentage: -1,
            theoreticalGrade: -1,
            theoreticalStatus: 'Pending',
            practicalGrade: -1,
            practicalStatus: 'Pending',
            finalGrade: -1,
            courseStatus: 'Pending',
            observation: undefined
          };
          
          const response: StudentProgressResponse = {
            success: true,
            data: progressData
          };
          res.json(response);
          return;
        }

        // If found in local DB, try again with the full username
        const fullUsername = participant.rut || participant.numeroInscripcion;
        const retryResult = await this.moodleService.getUserProgressInCourse(fullUsername, courseIdNum);
        
        if (!retryResult.success) {
          // Return -1 values when progress data is unavailable
          const progressData: StudentProgress = {
            username: participant.rut || participant.numeroInscripcion,
            completeName: this.getCompleteName(null, participant),
            courseId: courseIdNum,
            progressPercentage: -1,
            studentAttendancePercentage: -1,
            theoreticalGrade: -1,
            theoreticalStatus: 'Pending',
            practicalGrade: -1,
            practicalStatus: 'Pending',
            finalGrade: -1,
            courseStatus: 'Pending',
            observation: participant.observacion
          };
          
          const response: StudentProgressResponse = {
            success: true,
            data: progressData
          };
          res.json(response);
          return;
        }

        // Process the retry result
        const progressData = this.processProgressData(retryResult.data, participant, courseIdNum);
        const response: StudentProgressResponse = {
          success: true,
          data: progressData
        };
        res.json(response);
        return;
      }

      // Get additional data from local database if available
      const participant = await this.findParticipantByPartialUsername(username);

      // Process and format the progress data
      const progressData = this.processProgressData(moodleResult.data, participant, courseIdNum);

      const response: StudentProgressResponse = {
        success: true,
        data: progressData
      };

      res.json(response);

    } catch (error) {
      console.error('=== ERROR in getStudentProgress ===');
      console.error('Error type:', typeof error);
      console.error('Error message:', error instanceof Error ? error.message : error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('Full error object:', error);
      console.error('Request params - username:', username, 'courseId:', courseId);
      console.error('=====================================');
      
      const response: StudentProgressResponse = {
        success: false,
        error: {
          message: 'Internal server error while retrieving student progress',
          code: 'INTERNAL_ERROR',
          details: {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            params: { username: username || 'undefined', courseId: courseId || 'undefined' }
          }
        }
      };
      res.status(500).json(response);
    }
  }

  /**
   * Extract complete name from Moodle user data or local participant data
   */
  private getCompleteName(moodleUser: any, participant: Participante | null): string | undefined {
    // Try to get name from Moodle user data first
    if (moodleUser) {
      // Moodle user object typically has firstname, lastname, fullname fields
      if (moodleUser.fullname) {
        return moodleUser.fullname;
      }
      if (moodleUser.firstname && moodleUser.lastname) {
        return `${moodleUser.firstname} ${moodleUser.lastname}`.trim();
      }
      if (moodleUser.firstname) {
        return moodleUser.firstname;
      }
    }
    
    // Fall back to local participant data
    if (participant) {
      if (participant.nombres && participant.apellidos) {
        return `${participant.nombres} ${participant.apellidos}`.trim();
      }
      if (participant.nombres) {
        return participant.nombres;
      }
    }
    
    return undefined;
  }

  /**
   * Find participant in local database using partial username matching
   */
  private async findParticipantByPartialUsername(username: string): Promise<Participante | null> {
    try {
      const col = await getParticipantesCollection();
      
      // First try exact match on RUT or numeroInscripcion
      let participant = await col.findOne({
        $or: [
          { rut: username },
          { numeroInscripcion: username }
        ]
      });

      if (participant) {
        return participant;
      }

      // If no exact match, try partial matching using regex
      // This handles cases like "45678974" matching "45678974-2"
      const regexPattern = new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      
      participant = await col.findOne({
        $or: [
          { rut: { $regex: regexPattern } },
          { numeroInscripcion: { $regex: regexPattern } }
        ]
      });

      if (participant) {
        return participant;
      }

      // Try searching within the strings (contains)
      const containsPattern = new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      
      participant = await col.findOne({
        $or: [
          { rut: { $regex: containsPattern } },
          { numeroInscripcion: { $regex: containsPattern } }
        ]
      });

      return participant;

    } catch (error) {
      console.error('Error finding participant by partial username:', error);
      return null;
    }
  }

  /**
   * Process and format the raw Moodle progress data into our expected format
   */
  private processProgressData(
    moodleData: any, 
    participant: Participante | null, 
    courseId: number
  ): StudentProgress {
    const user = moodleData.user;
    const grades = moodleData.grades;
    const completion = moodleData.completion;
    const activities = moodleData.activities;

    // Calculate progress percentage based on completed activities
    let progressPercentage = 0;
    if (activities && Array.isArray(activities) && activities.length > 0) {
      const completedActivities = activities.filter(activity => activity.state === 1).length;
      progressPercentage = Math.round((completedActivities / activities.length) * 100);
    }

    // Calculate attendance percentage (this might need adjustment based on your Moodle setup)
    let attendancePercentage = 0;
    if (completion && completion.completions) {
      // This is a simplified calculation - you may need to adjust based on your attendance tracking method
      const attendanceActivities = completion.completions.filter((comp: any) => 
        comp.modulename === 'attendance' || comp.modulename === 'checklist'
      );
      if (attendanceActivities.length > 0) {
        const completedAttendance = attendanceActivities.filter((comp: any) => comp.completionstate > 0).length;
        attendancePercentage = Math.round((completedAttendance / attendanceActivities.length) * 100);
      }
    }

    // Extract grades information
    let theoreticalGrade: number = -1;
    let practicalGrade: number = -1;
    let finalGrade: number = -1;

    if (grades && grades.usergrades && grades.usergrades.length > 0) {
      const userGrades = grades.usergrades[0];
      if (userGrades.gradeitems) {
        // Look for different types of grades based on item names
        userGrades.gradeitems.forEach((item: any) => {
          const itemName = item.itemname?.toLowerCase() || '';
          const gradeValue = parseFloat(item.gradeformatted);
          
          if (!isNaN(gradeValue)) {
            if (itemName.includes('theoretical') || itemName.includes('teorico') || itemName.includes('teoria')) {
              theoreticalGrade = gradeValue;
            } else if (itemName.includes('practical') || itemName.includes('practico') || itemName.includes('practica')) {
              practicalGrade = gradeValue;
            } else if (itemName.includes('final') || itemName.includes('total') || item.itemtype === 'course') {
              finalGrade = gradeValue;
            }
          }
        });
      }
    }

    // Determine status based on grades (assuming 4.0 is passing grade, adjust as needed)
    const passingGrade = 4.0;
    const theoreticalStatus: 'Passed' | 'Failed' | 'Pending' = 
      theoreticalGrade === -1 ? 'Pending' : 
      theoreticalGrade >= passingGrade ? 'Passed' : 'Failed';

    const practicalStatus: 'Passed' | 'Failed' | 'Pending' = 
      practicalGrade === -1 ? 'Pending' : 
      practicalGrade >= passingGrade ? 'Passed' : 'Failed';

    const courseStatus: 'Passed' | 'Failed' | 'Pending' = 
      finalGrade === -1 ? 'Pending' : 
      finalGrade >= passingGrade ? 'Passed' : 'Failed';

    // Get observation from local participant data if available
    const observation = participant?.observacion;

    return {
      username: user.username,
      completeName: this.getCompleteName(user, participant),
      courseId,
      progressPercentage,
      studentAttendancePercentage: attendancePercentage,
      theoreticalGrade,
      theoreticalStatus,
      practicalGrade,
      practicalStatus,
      finalGrade,
      courseStatus,
      observation
    };
  }
}
