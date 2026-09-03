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
  | "블렌디드"
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

export type SatisfactionSurveyStatus = "불필요" | "확인필요";

export type ValidationStatus = "정상" | "검토필요";

export type SourceTeam = "1팀" | "2팀" | "미분류";

/**
 * 코스ID로 찾은 과정(Course) 한 건 — 자동 채움 조회용 최소 정보.
 * 한 코스ID에 과정이 여러 개인 경우가 있어(전체 16~18%) 항상 목록으로 다룬다.
 */
export interface CourseLookupCandidate {
  courseId: string;
  companyName: string;
  courseName: string;
  /** 이 과정의 가장 최근 회차 강의일정(yyyy-mm-dd). 회차가 없으면 null. */
  latestStartDate: null | string;
}

export interface OperationSession {
  id: string;
  operationId: string;
  sourceTeam?: SourceTeam;
  /** hub-om이 채번하는 과정ID(PRC-000123). Notion 등 외부 원천 병합 항목은 없을 수 있다. */
  processId?: string;
  /** Course.id (내부 UUID PK). 같은 과정의 여러 회차(OperationSession)가 이 값을 공유한다. */
  courseRecordId?: string;
  courseId: string;
  /** 코스ID 단위 라벨("코스ID명"). courseName("과정명")과 별도 테이블(CourseIdLabel)에 저장되며,
   * 같은 코스ID를 쓰는 모든 과정이 이 값을 공유한다. 아직 아무도 지정 안 했으면 빈 문자열. */
  courseIdLabel: string;
  /**
   * Company.id (내부 UUID PK). 기업을 식별하는 값이라 companyName 표기가 흔들려도
   * 같은 기업으로 묶인다. 로컬 JSON 저장소나 외부 원천 병합 항목에는 없을 수 있어 optional.
   */
  companyId?: string;
  companyName: string;
  courseName: string;
  courseCategory: string;
  tools: string;
  om: string;
  ld: string;
  onsiteOm: string;
  operationStatus: OperationStatus;
  archiveStatus: ArchiveStatus;
  educationFormat: EducationFormat;
  educationFormatRaw: string;
  operationChannel: OperationChannel;
  operationType: OperationType;
  operationTypeRaw: string;
  roundNo: string;
  educationDays: string;
  /** 실제 교육이 있는 날짜(yyyy-mm-dd) 목록. 과거 데이터 등 비어 있으면 startDate~endDate 전체를 교육일로 본다. */
  educationDates: string[];
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
  hasSatisfactionSurvey: SatisfactionSurveyStatus;
  hasResultReport: ResultReportStatus;
  resultReportLink: string;
  lectureManagementLink: string;
  lectureManagementNote: string;
  padletLink: string;
  validationStatus: ValidationStatus;
  validationErrors: string[];
}

export interface CreateOperationInput {
  archiveStatus: ArchiveStatus;
  coach: string;
  companyName: string;
  companyWikiLink: string;
  costRaw: string;
  courseCategory?: string;
  courseId: string;
  courseName: string;
  createdBy?: string;
  driveLink: string;
  educationDays: string;
  /** 실제 교육이 있는 날짜(yyyy-mm-dd) 목록. 있으면 startDate/endDate는 이 값의 최소/최대로 자동 계산한다. */
  educationDates?: string[];
  educationFormat: EducationFormat;
  endDate: string;
  instructorCost: number | null;
  instructorWikiLink: string;
  instructors: string;
  ld: string;
  lectureManagementLink: string;
  om: string;
  onsiteRequired: OnsiteRequired;
  operationCost: number | null;
  operationDetail: string;
  operationIssue: string;
  operationStatus: OperationStatus;
  operationType: OperationType;
  padletLink: string;
  region: string;
  resultReportLink: string;
  revenue: number | null;
  roundNo: string;
  specialNotes: string;
  startDate: string;
  timeText: string;
  tools?: string;
  totalCost: number | null;
}

export interface UpdateOperationInput {
  archiveStatus?: ArchiveStatus;
  avgSatisfaction?: string;
  coach?: string;
  companyWikiLink?: string;
  costRaw?: string;
  courseCategory?: string;
  courseId?: string;
  courseIdLabel?: string;
  courseName?: string;
  driveLink?: string;
  educationDays?: string;
  /** 실제 교육이 있는 날짜(yyyy-mm-dd) 목록. 전달하면 startDate/endDate는 이 값의 최소/최대로 다시 계산한다. */
  educationDates?: string[];
  educationFormat?: EducationFormat;
  endDate?: string;
  hasResultReport?: ResultReportStatus;
  hasSatisfactionSurvey?: SatisfactionSurveyStatus;
  instructorCost?: number | null;
  instructorSatisfaction?: string;
  instructors?: string;
  instructorWikiLink?: string;
  ld?: string;
  lectureManagementLink?: string;
  lectureManagementNote?: string;
  om?: string;
  onsiteOm?: string;
  onsiteRequired?: OnsiteRequired;
  operationCost?: number | null;
  operationDetail?: string;
  operationIssue?: string;
  operationStatus?: OperationStatus;
  omUpdate?: string;
  padletLink?: string;
  region?: string;
  resultReportLink?: string;
  specialNotes?: string;
  startDate?: string;
  timeText?: string;
  tools?: string;
  totalCost?: number | null;
}

export interface OperationSummary {
  total: number;
  active: number;
  assignmentNeeded: number;
  archiveNeeded: number;
  missingSatisfaction: number;
  missingResultReport: number;
}
