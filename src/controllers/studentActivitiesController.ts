import { Request, Response } from 'express';
import { MoodleService } from '../services/moodleService';
import { StudentProgressResponse } from '../types/studentProgress';
import { Participante } from '../types/participante';
import { getParticipantesCollection } from '../db/mongo';

interface ActivityGradeItem {
  itemid?: number;
  itemname?: string;
  itemtype?: string;
  itemmodule?: string;
  categoryid?: number;
  graderaw?: number | null;
  gradeformatted?: string | null;
  grademin?: number | null;
  grademax?: number | null;
  locked?: boolean;
  hidden?: boolean;
}

interface ActivitiesGradesResponse {
  username: string;
  completeName?: string;
  courseId: number;
  grades: ActivityGradeItem[];
  raw?: any; // include raw Moodle response for transparency/debugging
}

export class StudentActivitiesController {
  private moodleService: MoodleService;

  constructor() {
    this.moodleService = new MoodleService();
  }

  // GET /api/grades/activities?username=...&courseId=...
  async getActivitiesGrades(req: Request, res: Response) {
    const { username, courseId } = req.query as { username?: string; courseId?: string };

    try {
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

      // Resolve user by exact or partial username using Moodle first
      let userLookup = await this.moodleService.getUserByUsername(username);
      let users = this.unwrapUsers(userLookup.data);
      if (!userLookup.success || users.length === 0) {
        userLookup = await this.moodleService.searchUsersByPartialUsername(username);
        users = this.unwrapUsers(userLookup.data);
      }

      if (!userLookup.success || users.length === 0) {
        // Try local DB to infer a more complete username
        const participant = await this.findParticipantByPartialUsername(username);
        if (!participant) {
          // For this endpoint, return empty grades list when user cannot be resolved
          const response: ActivitiesGradesResponse = {
            username,
            completeName: undefined,
            courseId: courseIdNum,
            grades: []
          };
          res.json({ success: true, data: response });
          return;
        }
        // Retry Moodle lookup with fuller username
        const altUsername = String(participant.rut || participant.numeroInscripcion);
        userLookup = await this.moodleService.getUserByUsername(altUsername);
        users = this.unwrapUsers(userLookup.data);
        if (!userLookup.success || users.length === 0) {
          userLookup = await this.moodleService.searchUsersByPartialUsername(altUsername);
          users = this.unwrapUsers(userLookup.data);
        }
      }

      if (!userLookup.success || users.length === 0) {
        // No user found even after retries
        const response: ActivitiesGradesResponse = {
          username,
          completeName: undefined,
          courseId: courseIdNum,
          grades: []
        };
        res.json({ success: true, data: response });
        return;
      }

      // Pick best match
      let user = users[0];
      const exactMatch = users.find((u: any) => u.username === username);
      const startsWithMatch = users.find((u: any) => typeof u.username === 'string' && u.username.startsWith(username));
      user = exactMatch || startsWithMatch || user;

      const userId = user.id;

      // Fetch grades via Moodle service (handles primary + alternative functions)
      const gradesResult = await this.moodleService.getUserGrades(courseIdNum, userId);

      if (!gradesResult.success) {
        const response: ActivitiesGradesResponse = {
          username: user.username,
          completeName: this.getCompleteName(user, null),
          courseId: courseIdNum,
          grades: [],
          raw: gradesResult.error
        };
        res.json({ success: true, data: response });
        return;
      }

      const mapped = this.mapGrades(gradesResult.data);

      // Try to enrich with local participant name if Moodle fullname is missing
      let completeName = this.getCompleteName(user, null);
      if (!completeName) {
        const participant = await this.findParticipantByPartialUsername(username);
        completeName = this.getCompleteName(null, participant);
      }

      const response: ActivitiesGradesResponse = {
        username: user.username,
        completeName,
        courseId: courseIdNum,
        grades: mapped.grades,
        raw: mapped.raw
      };

      res.json({ success: true, data: response });

    } catch (error) {
      console.error('Error in getActivitiesGrades:', error);
      res.status(500).json({
        success: false,
        error: {
          message: 'Internal server error while retrieving activities grades',
          code: 'INTERNAL_ERROR',
          details: error instanceof Error ? error.message : error
        }
      });
    }
  }

  private unwrapUsers(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as any).users)) return (data as any).users;
    // Some sites may return an object keyed by id
    if (data && typeof data === 'object' && (data as any).users && typeof (data as any).users === 'object') {
      return Object.values((data as any).users);
    }
    return [];
  }

  private getCompleteName(moodleUser: any, participant: Participante | null): string | undefined {
    if (moodleUser) {
      if (moodleUser.fullname) return moodleUser.fullname;
      if (moodleUser.firstname && moodleUser.lastname) return `${moodleUser.firstname} ${moodleUser.lastname}`.trim();
      if (moodleUser.firstname) return moodleUser.firstname;
    }
    if (participant) {
      if (participant.nombres && participant.apellidos) return `${participant.nombres} ${participant.apellidos}`.trim();
      if (participant.nombres) return participant.nombres;
    }
    return undefined;
  }

  private async findParticipantByPartialUsername(username: string): Promise<Participante | null> {
    try {
      const col = await getParticipantesCollection();
      let participant = await col.findOne({
        $or: [ { rut: username }, { numeroInscripcion: username } ]
      });
      if (participant) return participant as Participante;

      const regexPattern = new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      participant = await col.findOne({
        $or: [ { rut: { $regex: regexPattern } }, { numeroInscripcion: { $regex: regexPattern } } ]
      });
      if (participant) return participant as Participante;

      const containsPattern = new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      participant = await col.findOne({
        $or: [ { rut: { $regex: containsPattern } }, { numeroInscripcion: { $regex: containsPattern } } ]
      });
      return participant as Participante | null;
    } catch (e) {
      console.error('Error finding participant by partial username:', e);
      return null;
    }
  }

  private mapGrades(rawData: any): { grades: ActivityGradeItem[]; raw: any } {
    // Handle gradereport_user_get_grade_items shape
    if (rawData && rawData.usergrades && Array.isArray(rawData.usergrades) && rawData.usergrades.length > 0) {
      const ug = rawData.usergrades[0];
      const items: ActivityGradeItem[] = Array.isArray(ug.gradeitems)
        ? ug.gradeitems.map((gi: any) => ({
            itemid: gi.id ?? gi.itemid,
            itemname: gi.itemname,
            itemtype: gi.itemtype,
            itemmodule: gi.itemmodule,
            categoryid: gi.categoryid,
            graderaw: gi.graderaw ?? null,
            gradeformatted: gi.gradeformatted ?? null,
            grademin: gi.grademin ?? null,
            grademax: gi.grademax ?? null,
            locked: gi.locked ?? false,
            hidden: gi.hidden ?? false,
          }))
        : [];
      return { grades: items, raw: rawData };
    }

    // Handle possible core_grades_get_grades shape
    // We try to reconstruct per-item grades joining items[] and grades mapping
    if (rawData && rawData.items && Array.isArray(rawData.items)) {
      const itemsIndex: Record<number, any> = {};
      for (const it of rawData.items) {
        if (typeof it.id === 'number') itemsIndex[it.id] = it;
      }
      const grades: ActivityGradeItem[] = [];
      // Some Moodle versions return a `grades` object keyed by itemid containing list of user grades
      // Try to extract user's grade if present
      if (rawData.grades) {
        for (const itemIdStr of Object.keys(rawData.grades)) {
          const itemId = Number(itemIdStr);
          const itemMeta = itemsIndex[itemId] || {};
          const userGrades = rawData.grades[itemIdStr];
          const ug = Array.isArray(userGrades) ? userGrades[0] : userGrades; // best-effort
          grades.push({
            itemid: itemId,
            itemname: itemMeta.itemname,
            itemtype: itemMeta.itemtype,
            itemmodule: itemMeta.itemmodule,
            categoryid: itemMeta.categoryid,
            graderaw: ug?.grade ?? null,
            gradeformatted: ug?.str_grade ?? null,
            grademin: itemMeta.grademin ?? null,
            grademax: itemMeta.grademax ?? null,
            locked: itemMeta.locked ?? false,
            hidden: itemMeta.hidden ?? false,
          });
        }
      }
      return { grades, raw: rawData };
    }

    // Fallback: unknown shape
    return { grades: [], raw: rawData };
  }
}

