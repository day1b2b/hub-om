export type AdminDatabaseTableKey = "companies" | "courses" | "members" | "operation_sessions";
export type AdminDatabaseInputKind = "boolean" | "date" | "enum" | "integer" | "money" | "text" | "textarea";

export interface AdminEditableField {
  field: string;
  input: AdminDatabaseInputKind;
  label: string;
  nullable?: boolean;
  optionLabels?: Record<string, string>;
  options?: string[];
}

export const ADMIN_ENUM_LABELS: Record<string, Record<string, string>> = {
  archiveStatus: {
    DONE: "완료",
    NEEDED: "아카이빙필요",
    NOT_READY: "아카이빙전"
  },
  educationFormat: {
    BLENDED: "블렌디드",
    FLIPPED: "플립러닝",
    NEEDS_REVIEW: "검토필요",
    OFFLINE: "오프라인",
    REMOTE: "비대면"
  },
  hasResultReport: {
    NEEDS_REVIEW: "확인필요",
    NO: "무",
    NOT_REQUIRED: "불필요",
    YES: "유"
  },
  importStatus: {
    COMPLETED: "완료",
    COMPLETED_WITH_ERRORS: "오류 포함 완료",
    FAILED: "실패",
    PENDING: "진행중",
    completed: "완료",
    completed_with_errors: "오류 포함 완료",
    failed: "실패",
    pending: "진행중"
  },
  inputKind: {
    driveLink: "Drive 값",
    folderSearch: "폴더 검색",
    lectureManagementLink: "강의관리 링크"
  },
  isActive: {
    false: "비활성",
    true: "활성"
  },
  operationChannel: {
    BLENDED: "블렌디드",
    LIVE_ONLINE: "실시간 비대면",
    NEEDS_REVIEW: "검토필요",
    ONLINE_PLATFORM: "온라인 플랫폼",
    ONSITE: "출강"
  },
  operationStatus: {
    ACTIVE: "진행중",
    ARCHIVE_NEEDED: "아카이빙필요",
    ASSIGNMENT_NEEDED: "배정필요",
    ASSIGNMENT_PLANNED: "배정예정",
    DONE: "완료",
    RETROSPECTIVE_DONE: "회고완료"
  },
  operationType: {
    ALWAYS_ON: "상시형",
    ANNUAL: "연간",
    LECTURE: "특강",
    LONG: "장기",
    MEDIUM: "중기",
    MID_LONG: "준장기",
    MID_TERM_LONG: "중장기",
    NEEDS_REVIEW: "검토필요",
    SHORT: "단기"
  },
  onsiteRequired: {
    N: "아니오",
    PARTIAL: "일부",
    UNKNOWN: "확인필요",
    Y: "예"
  },
  resultKind: {
    error: "오류",
    folder_search_candidates: "폴더 후보",
    folder_search_empty: "후보 없음",
    scan_found_folder: "폴더 확인",
    scan_no_folder: "폴더 미확인"
  },
  runMode: {
    dry_run: "드라이런"
  },
  role: {
    LD: "LD",
    OM: "OM"
  },
  sourceTeam: {
    TEAM_1: "1팀",
    TEAM_2: "2팀",
    UNKNOWN: "미분류"
  }
};

export const ADMIN_EDITABLE_FIELDS = {
  companies: [
    { field: "name", input: "text", label: "기업명" }
  ],
  courses: [
    { field: "courseId", input: "text", label: "코스ID", nullable: true },
    { field: "name", input: "text", label: "과정명" },
    {
      field: "operationType",
      input: "enum",
      label: "운영유형",
      optionLabels: ADMIN_ENUM_LABELS.operationType,
      options: ["LECTURE", "SHORT", "MEDIUM", "MID_TERM_LONG", "MID_LONG", "LONG", "ANNUAL", "ALWAYS_ON", "NEEDS_REVIEW"]
    },
    { field: "revenue", input: "money", label: "매출", nullable: true }
  ],
  members: [
    { field: "role", input: "enum", label: "역할", nullable: true, optionLabels: ADMIN_ENUM_LABELS.role, options: ["", "OM", "LD"] },
    { field: "sourceTeam", input: "enum", label: "팀", nullable: true, optionLabels: ADMIN_ENUM_LABELS.sourceTeam, options: ["", "TEAM_1", "TEAM_2", "UNKNOWN"] },
    { field: "name", input: "text", label: "이름" },
    { field: "roleTitle", input: "text", label: "직함", nullable: true },
    { field: "calendarId", input: "text", label: "캘린더ID", nullable: true },
    { field: "isActive", input: "boolean", label: "활성", optionLabels: ADMIN_ENUM_LABELS.isActive },
    { field: "displayOrder", input: "integer", label: "표시순서", nullable: true }
  ],
  operation_sessions: [
    {
      field: "operationStatus",
      input: "enum",
      label: "상태",
      optionLabels: ADMIN_ENUM_LABELS.operationStatus,
      options: ["ASSIGNMENT_NEEDED", "ASSIGNMENT_PLANNED", "ACTIVE", "DONE", "RETROSPECTIVE_DONE", "ARCHIVE_NEEDED"]
    },
    { field: "archiveStatus", input: "enum", label: "아카이브", optionLabels: ADMIN_ENUM_LABELS.archiveStatus, options: ["NOT_READY", "NEEDED", "DONE"] },
    { field: "educationFormat", input: "enum", label: "교육형태", optionLabels: ADMIN_ENUM_LABELS.educationFormat, options: ["OFFLINE", "REMOTE", "BLENDED", "FLIPPED", "NEEDS_REVIEW"] },
    {
      field: "operationChannel",
      input: "enum",
      label: "채널",
      optionLabels: ADMIN_ENUM_LABELS.operationChannel,
      options: ["ONSITE", "LIVE_ONLINE", "ONLINE_PLATFORM", "BLENDED", "NEEDS_REVIEW"]
    },
    { field: "roundNo", input: "text", label: "차수", nullable: true },
    { field: "educationDays", input: "text", label: "교육일", nullable: true },
    { field: "startDate", input: "date", label: "시작일" },
    { field: "endDate", input: "date", label: "종료일" },
    { field: "timeText", input: "text", label: "시간", nullable: true },
    { field: "omName", input: "text", label: "OM", nullable: true },
    { field: "ldName", input: "text", label: "LD", nullable: true },
    { field: "instructorsText", input: "text", label: "강사", nullable: true },
    { field: "coachText", input: "text", label: "코치", nullable: true },
    { field: "region", input: "text", label: "지역", nullable: true },
    { field: "onsiteRequired", input: "enum", label: "출강", optionLabels: ADMIN_ENUM_LABELS.onsiteRequired, options: ["Y", "N", "PARTIAL", "UNKNOWN"] },
    { field: "specialNotes", input: "textarea", label: "특이사항", nullable: true },
    { field: "operationIssue", input: "textarea", label: "운영이슈", nullable: true },
    { field: "omUpdate", input: "textarea", label: "OM 업데이트", nullable: true },
    { field: "driveLink", input: "text", label: "Drive", nullable: true },
    { field: "operationDetail", input: "text", label: "싱크업", nullable: true },
    { field: "companyWikiLink", input: "text", label: "기업 Wiki", nullable: true },
    { field: "instructorWikiLink", input: "text", label: "강사 Wiki", nullable: true },
    { field: "costRaw", input: "text", label: "비용 원문", nullable: true },
    { field: "totalCost", input: "money", label: "총비용", nullable: true },
    { field: "instructorCost", input: "money", label: "강사비", nullable: true },
    { field: "operationCost", input: "money", label: "운영비", nullable: true },
    { field: "avgSatisfaction", input: "text", label: "전체 만족도", nullable: true },
    { field: "instructorSatisfaction", input: "text", label: "강사 만족도", nullable: true },
    { field: "hasResultReport", input: "enum", label: "결과보고", optionLabels: ADMIN_ENUM_LABELS.hasResultReport, options: ["YES", "NO", "NOT_REQUIRED", "NEEDS_REVIEW"] },
    { field: "resultReportLink", input: "text", label: "결과보고서", nullable: true },
    { field: "lectureManagementLink", input: "text", label: "강의관리", nullable: true },
    { field: "padletLink", input: "text", label: "패들렛", nullable: true }
  ]
} as const satisfies Record<AdminDatabaseTableKey, readonly AdminEditableField[]>;

export function getAdminEditableField(tableKey: string, field: string): AdminEditableField | null {
  if (!isAdminEditableTableKey(tableKey)) return null;

  return ADMIN_EDITABLE_FIELDS[tableKey].find((editableField) => editableField.field === field) ?? null;
}

export function isAdminEditableTableKey(value: string): value is AdminDatabaseTableKey {
  return value === "companies" || value === "courses" || value === "members" || value === "operation_sessions";
}
