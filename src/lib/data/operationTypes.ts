export type OperationStatus =
  | "배정필요"
  | "배정예정"
  | "진행중"
  | "완료"
  | "회고완료"
  | "아카이빙필요";

export type ArchiveStatus = "아카이빙전" | "아카이빙필요" | "완료";

export type EducationFormat =
  | "오프라인"
  | "비대면"
  | "블랜디드"
  | "플립러닝"
  | "검토필요";

export type OperationChannel =
  | "onsite"
  | "live_online"
  | "online_platform"
  | "blended"
  | "needs_review";

export type OperationType =
  | "특강"
  | "단기"
  | "중기"
  | "중장기"
  | "준장기"
  | "장기"
  | "연간"
  | "상시형"
  | "검토필요";

export type OnsiteRequired = "Y" | "N" | "PARTIAL" | "UNKNOWN";

export type ResultReportStatus = "유" | "무" | "불필요" | "확인필요";

export type ValidationStatus = "정상" | "검토필요";

export interface OperationSession {
  id: string;
  operationId: string;
  courseId: string;
  companyName: string;
  courseName: string;
  om: string;
  ld: string;
  operationStatus: OperationStatus;
  archiveStatus: ArchiveStatus;
  educationFormat: EducationFormat;
  educationFormatRaw: string;
  operationChannel: OperationChannel;
  operationType: OperationType;
  operationTypeRaw: string;
  roundNo: string;
  educationDays: string;
  startDate: string;
  endDate: string;
  operationMonth: string;
  sessionDurationDays: number | null;
  sessionDurationType: OperationType;
  timeText: string;
  instructors: string;
  coach: string;
  region: string;
  onsiteRequired: OnsiteRequired;
  onsiteText: string;
  specialNotes: string;
  operationIssue: string;
  omUpdate: string;
  driveLink: string;
  operationDetail: string;
  companyWikiLink: string;
  instructorWikiLink: string;
  revenue: number | null;
  costRaw: string;
  profitRaw: string;
  totalCost: number | null;
  instructorCost: number | null;
  operationCost: number | null;
  profit: number | null;
  avgSatisfaction: string;
  instructorSatisfaction: string;
  hasResultReport: ResultReportStatus;
  resultReportLink: string;
  lectureManagementLink: string;
  padletLink: string;
  validationStatus: ValidationStatus;
  validationErrors: string[];
}

export interface OperationSummary {
  total: number;
  active: number;
  assignmentNeeded: number;
  archiveNeeded: number;
  missingSatisfaction: number;
  missingResultReport: number;
}
