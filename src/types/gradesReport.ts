export interface GradesReportData {
  passed: any[];
  failed: any[];
}

export interface GradesReportDoc {
  _id?: string;
  numeroInscripcion: string;
  data: GradesReportData;
  updatedAt: Date;
}
