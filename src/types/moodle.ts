// Moodle Web Service types

export interface MoodleWebServiceParams {
  wsfunction: string;
  [key: string]: string | number;
}

export interface MoodleWebServiceFullParams extends MoodleWebServiceParams {
  wstoken: string;
  moodlewsrestformat: 'json' | 'xml';
}

export interface MoodleCourse {
  id: number;
  fullname: string;
  displayname: string;
  shortname: string;
  courseimage: string;
  categoryid: number;
  categoryname: string;
  sortorder: number;
  summary: string;
  summaryformat: number;
  format: string;
  showgrades: number;
  newsitems: number;
  startdate: number;
  enddate: number;
  numsections: number;
  maxbytes: number;
  showreports: number;
  visible: number;
  hiddensections: number;
  groupmode: number;
  groupmodeforce: number;
  defaultgroupingid: number;
  timecreated: number;
  timemodified: number;
  enablecompletion: number;
  completionnotify: number;
  lang: string;
  forcetheme: string;
  courseformatoptions: Array<{
    name: string;
    value: number | string;
  }>;
}

export interface MoodleCoursesResponse {
  courses: MoodleCourse[];
  warnings?: Array<{
    item: string;
    itemid: number;
    warningcode: string;
    message: string;
  }>;
}

export interface SimplifiedCourse {
  id: number;
  fullname: string;
  startdate: number;
  enddate: number;
  students: number;
}

export interface SimplifiedCoursesResponse {
  courses: SimplifiedCourse[];
  warnings?: Array<{
    item: string;
    itemid: number;
    warningcode: string;
    message: string;
  }>;
}

export interface MoodleErrorResponse {
  exception: string;
  errorcode: string;
  message: string;
  debuginfo?: string;
}

export interface MoodleCategory {
  id: number;
  name: string;
  idnumber: string;
  description: string;
  descriptionformat: number;
  parent: number;
  sortorder: number;
  coursecount: number;
  visible: number;
  visibleold: number;
  timemodified: number;
  depth: number;
  path: string;
  theme?: string;
}

// Note: core_course_get_categories returns an array directly, not wrapped in an object
export type MoodleCategoriesResponse = MoodleCategory[];

export interface MoodleCategoriesApiResponse {
  categories: MoodleCategory[];
  warnings?: Array<{
    item: string;
    itemid: number;
    warningcode: string;
    message: string;
  }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}
