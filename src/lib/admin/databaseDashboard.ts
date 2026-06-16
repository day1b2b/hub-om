import { getPrismaClient } from "@/lib/data/prisma";
import { ADMIN_ENUM_LABELS, getAdminEditableField } from "@/lib/admin/databaseEditConfig";

export interface DatabaseCellOption {
  label: string;
  value: string;
}

export interface DatabaseCellPreview {
  editable?: boolean;
  field?: string;
  input?: string;
  label: string;
  options?: DatabaseCellOption[];
  rawValue?: string;
  value: string;
  tone?: "muted" | "warning";
}

export interface DatabaseRowPreview {
  cells: DatabaseCellPreview[];
  href?: string;
  id: string;
  title: string;
}

export interface DatabaseTableSnapshot {
  description: string;
  key: string;
  latestActivity: string;
  notes?: string;
  rowCount: number;
  rows: DatabaseRowPreview[];
  tableName: string;
  title: string;
}

export interface DatabaseDashboardSnapshot {
  generatedAt: string;
  tables: DatabaseTableSnapshot[];
  totalRows: number;
}

export const DATABASE_TABLE_SAMPLE_LIMIT = 100;

export async function readDatabaseDashboard(): Promise<DatabaseDashboardSnapshot> {
  const prisma = getPrismaClient();
  const [
    companyCount,
    companies,
    courseCount,
    courses,
    operationSessionCount,
    operationSessions,
    memberCount,
    members,
    dataImportRunCount,
    dataImportRuns,
    operationSourceRecordCount,
    operationSourceRecords,
    driveImportRunCount,
    driveImportRuns,
    driveImportResultCount,
    driveImportResults
  ] = await Promise.all([
    prisma.company.count(),
    prisma.company.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        courses: { select: { id: true }, take: 1 },
        createdAt: true,
        updatedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.course.count(),
    prisma.course.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        courseId: true,
        name: true,
        operationType: true,
        revenue: true,
        company: { select: { name: true } },
        sessions: { select: { id: true }, take: 1 },
        createdAt: true,
        updatedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.operationSession.count(),
    prisma.operationSession.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        operationId: true,
        operationStatus: true,
        archiveStatus: true,
        educationFormat: true,
        operationChannel: true,
        roundNo: true,
        educationDays: true,
        startDate: true,
        endDate: true,
        timeText: true,
        omName: true,
        ldName: true,
        instructorsText: true,
        coachText: true,
        region: true,
        onsiteRequired: true,
        specialNotes: true,
        operationIssue: true,
        omUpdate: true,
        driveLink: true,
        operationDetail: true,
        companyWikiLink: true,
        instructorWikiLink: true,
        costRaw: true,
        totalCost: true,
        instructorCost: true,
        operationCost: true,
        avgSatisfaction: true,
        instructorSatisfaction: true,
        hasResultReport: true,
        resultReportLink: true,
        lectureManagementLink: true,
        padletLink: true,
        deletedAt: true,
        updatedAt: true,
        course: {
          select: {
            name: true,
            company: { select: { name: true } }
          }
        }
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.member.count(),
    prisma.member.findMany({
      orderBy: [{ isActive: "desc" }, { displayOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        role: true,
        sourceTeam: true,
        name: true,
        roleTitle: true,
        isActive: true,
        calendarId: true,
        displayOrder: true,
        updatedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.dataImportRun.count(),
    prisma.dataImportRun.findMany({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        sourceTeam: true,
        sourceType: true,
        sourceName: true,
        workbookName: true,
        fileName: true,
        status: true,
        rowCount: true,
        successCount: true,
        errorCount: true,
        startedAt: true,
        finishedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.operationSourceRecord.count(),
    prisma.operationSourceRecord.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        sourceTeam: true,
        sourceWorkbook: true,
        sourceSheet: true,
        sourceRowNumber: true,
        sourceFingerprint: true,
        rowSnapshot: true,
        mappedFields: true,
        validationErrors: true,
        createdAt: true,
        operationSession: { select: { operationId: true } }
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.driveImportRun.count(),
    prisma.driveImportRun.findMany({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        mode: true,
        status: true,
        operationCount: true,
        scannedRefCount: true,
        folderSearchCount: true,
        errorCount: true,
        startedAt: true,
        finishedAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    }),
    prisma.driveImportResult.count(),
    prisma.driveImportResult.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        operationId: true,
        companyName: true,
        courseName: true,
        inputKind: true,
        resultKind: true,
        candidateCount: true,
        fileCount: true,
        issues: true,
        error: true,
        createdAt: true
      },
      take: DATABASE_TABLE_SAMPLE_LIMIT
    })
  ]);

  const tables: DatabaseTableSnapshot[] = [
    {
      description: "기업 마스터. 과정 레코드가 이 테이블의 기업을 참조합니다.",
      key: "companies",
      latestActivity: isoDateTime(companies[0]?.updatedAt),
      rowCount: companyCount,
      rows: companies.map((company) => ({
        cells: [
          { label: "정규화명", value: company.normalizedName },
          editableCell("companies", "name", company.name),
          { label: "과정 연결", value: company.courses.length > 0 ? "있음" : "없음", tone: company.courses.length > 0 ? undefined : "muted" },
          { label: "생성", value: formatDateTime(company.createdAt) },
          { label: "갱신", value: formatDateTime(company.updatedAt) }
        ],
        id: company.id,
        title: company.name
      })),
      tableName: "기업 마스터",
      title: "기업"
    },
    {
      description: "과정 마스터. 기업, 코스ID, 과정명, 운영유형과 매출 기준을 보관합니다.",
      key: "courses",
      latestActivity: isoDateTime(courses[0]?.updatedAt),
      rowCount: courseCount,
      rows: courses.map((course) => ({
        cells: [
          { label: "기업", value: course.company.name },
          editableCell("courses", "name", course.name),
          editableCell("courses", "courseId", course.courseId),
          editableCell("courses", "operationType", course.operationType),
          editableCell("courses", "revenue", moneyValue(course.revenue)),
          { label: "운영 연결", value: course.sessions.length > 0 ? "있음" : "없음", tone: course.sessions.length > 0 ? undefined : "muted" }
        ],
        id: course.id,
        title: course.name
      })),
      tableName: "과정 마스터",
      title: "과정"
    },
    {
      description: "운영 차수. 운영 현황 화면의 행 기준이 되는 핵심 테이블입니다.",
      key: "operation_sessions",
      latestActivity: isoDateTime(operationSessions[0]?.updatedAt),
      rowCount: operationSessionCount,
      rows: operationSessions.map((session) => ({
        cells: [
          { label: "기업", value: session.course.company.name },
          editableCell("operation_sessions", "operationStatus", session.operationStatus),
          editableCell("operation_sessions", "archiveStatus", session.archiveStatus),
          editableCell("operation_sessions", "educationFormat", session.educationFormat),
          editableCell("operation_sessions", "operationChannel", session.operationChannel),
          editableCell("operation_sessions", "startDate", formatDate(session.startDate)),
          editableCell("operation_sessions", "endDate", formatDate(session.endDate)),
          editableCell("operation_sessions", "roundNo", session.roundNo ?? ""),
          editableCell("operation_sessions", "educationDays", session.educationDays ?? ""),
          editableCell("operation_sessions", "timeText", session.timeText ?? ""),
          editableCell("operation_sessions", "omName", session.omName ?? "", session.omName ? undefined : "warning"),
          editableCell("operation_sessions", "ldName", session.ldName ?? "", session.ldName ? undefined : "muted"),
          editableCell("operation_sessions", "instructorsText", session.instructorsText ?? ""),
          editableCell("operation_sessions", "coachText", session.coachText ?? ""),
          editableCell("operation_sessions", "region", session.region ?? ""),
          editableCell("operation_sessions", "onsiteRequired", session.onsiteRequired),
          editableCell("operation_sessions", "specialNotes", session.specialNotes ?? ""),
          editableCell("operation_sessions", "operationIssue", session.operationIssue ?? ""),
          editableCell("operation_sessions", "omUpdate", session.omUpdate ?? ""),
          editableCell("operation_sessions", "driveLink", session.driveLink ?? ""),
          editableCell("operation_sessions", "operationDetail", session.operationDetail ?? ""),
          editableCell("operation_sessions", "companyWikiLink", session.companyWikiLink ?? ""),
          editableCell("operation_sessions", "instructorWikiLink", session.instructorWikiLink ?? ""),
          editableCell("operation_sessions", "costRaw", session.costRaw ?? ""),
          editableCell("operation_sessions", "totalCost", moneyValue(session.totalCost)),
          editableCell("operation_sessions", "instructorCost", moneyValue(session.instructorCost)),
          editableCell("operation_sessions", "operationCost", moneyValue(session.operationCost)),
          editableCell("operation_sessions", "avgSatisfaction", session.avgSatisfaction ?? ""),
          editableCell("operation_sessions", "instructorSatisfaction", session.instructorSatisfaction ?? ""),
          editableCell("operation_sessions", "hasResultReport", session.hasResultReport),
          editableCell("operation_sessions", "resultReportLink", session.resultReportLink ?? ""),
          editableCell("operation_sessions", "lectureManagementLink", session.lectureManagementLink ?? ""),
          editableCell("operation_sessions", "padletLink", session.padletLink ?? ""),
          { label: "삭제", value: session.deletedAt ? formatDateTime(session.deletedAt) : "아니오", tone: session.deletedAt ? "warning" : undefined }
        ],
        href: `/operations/${session.operationId}`,
        id: session.id,
        title: `${session.operationId} · ${session.course.name}`
      })),
      tableName: "운영 차수",
      title: "운영 차수"
    },
    {
      description: "OM/LD 구성원과 팀, 캘린더 연결 정보를 보관합니다.",
      key: "members",
      latestActivity: isoDateTime(members[0]?.updatedAt),
      rowCount: memberCount,
      rows: members.map((member) => ({
        cells: [
          editableCell("members", "role", member.role ?? ""),
          editableCell("members", "sourceTeam", member.sourceTeam ?? ""),
          editableCell("members", "name", member.name),
          editableCell("members", "roleTitle", member.roleTitle ?? ""),
          editableCell("members", "isActive", member.isActive ? "true" : "false", member.isActive ? undefined : "muted"),
          editableCell("members", "calendarId", member.calendarId ?? "", member.calendarId ? undefined : "muted"),
          editableCell("members", "displayOrder", member.displayOrder === null ? "" : String(member.displayOrder)),
          { label: "갱신", value: formatDateTime(member.updatedAt) }
        ],
        id: member.id,
        title: member.name
      })),
      tableName: "구성원",
      title: "구성원"
    },
    {
      description: "원천 적재 실행 단위. 성공/오류 건수와 실행 상태를 확인합니다.",
      key: "data_import_runs",
      latestActivity: isoDateTime(dataImportRuns[0]?.startedAt),
      rowCount: dataImportRunCount,
      rows: dataImportRuns.map((run) => ({
        cells: [
          { label: "팀", value: displayEnumValue("sourceTeam", run.sourceTeam) },
          { label: "원천", value: run.sourceType },
          { label: "원천명", value: run.sourceName },
          { label: "파일", value: run.fileName || run.workbookName ? "입력 있음" : "-", tone: run.fileName || run.workbookName ? undefined : "muted" },
          { label: "상태", value: displayEnumValue("importStatus", run.status) },
          { label: "성공/전체", value: `${run.successCount}/${run.rowCount}` },
          { label: "오류", value: String(run.errorCount), tone: run.errorCount > 0 ? "warning" : undefined },
          { label: "시작", value: formatDateTime(run.startedAt) }
        ],
        id: run.id,
        title: shortId(run.id)
      })),
      tableName: "원천 적재 실행",
      title: "적재 실행"
    },
    {
      description: "원천 행 스냅샷. 실제 raw JSON 전문 대신 필드 수와 연결 상태만 요약합니다.",
      key: "operation_source_records",
      latestActivity: isoDateTime(operationSourceRecords[0]?.createdAt),
      notes: "원천 스냅샷, 매핑 필드, 검증 오류는 민감한 원천 값이 섞일 수 있어 요약만 표시합니다.",
      rowCount: operationSourceRecordCount,
      rows: operationSourceRecords.map((record) => ({
        cells: [
          { label: "팀", value: displayEnumValue("sourceTeam", record.sourceTeam) },
          { label: "원천", value: `${record.sourceWorkbook} / ${record.sourceSheet}` },
          { label: "행", value: String(record.sourceRowNumber) },
          { label: "운영", value: record.operationSession?.operationId ?? "미연결", tone: record.operationSession ? undefined : "warning" },
          { label: "중복키", value: record.sourceFingerprint ? shortId(record.sourceFingerprint) : "-", tone: record.sourceFingerprint ? undefined : "muted" },
          { label: "원천 요약", value: summarizeJson(record.rowSnapshot) },
          { label: "매핑 요약", value: summarizeJson(record.mappedFields) },
          { label: "검증", value: summarizeJson(record.validationErrors), tone: hasJsonContent(record.validationErrors) ? "warning" : undefined }
        ],
        id: record.id,
        title: shortId(record.id)
      })),
      tableName: "원천 행 기록",
      title: "원천 행"
    },
    {
      description: "Drive 조회 실행 이력. 운영 데이터는 바꾸지 않고 후보 조회 결과만 저장합니다.",
      key: "drive_import_runs",
      latestActivity: isoDateTime(driveImportRuns[0]?.startedAt),
      rowCount: driveImportRunCount,
      rows: driveImportRuns.map((run) => ({
        cells: [
          { label: "모드", value: displayEnumValue("runMode", run.mode) },
          { label: "상태", value: displayEnumValue("importStatus", run.status) },
          { label: "운영", value: String(run.operationCount) },
          { label: "링크 스캔", value: String(run.scannedRefCount) },
          { label: "폴더 검색", value: String(run.folderSearchCount) },
          { label: "오류", value: String(run.errorCount), tone: run.errorCount > 0 ? "warning" : undefined },
          { label: "시작", value: formatDateTime(run.startedAt) },
          { label: "완료", value: run.finishedAt ? formatDateTime(run.finishedAt) : "진행/미완료", tone: run.finishedAt ? undefined : "muted" }
        ],
        id: run.id,
        title: shortId(run.id)
      })),
      tableName: "Drive 조회 실행",
      title: "Drive 조회 실행"
    },
    {
      description: "Drive 조회 결과. 운영별 후보 수와 오류 여부를 확인합니다.",
      key: "drive_import_results",
      latestActivity: isoDateTime(driveImportResults[0]?.createdAt),
      rowCount: driveImportResultCount,
      rows: driveImportResults.map((result) => ({
        cells: [
          { label: "운영ID", value: result.operationId },
          { label: "기업", value: result.companyName },
          { label: "입력", value: displayEnumValue("inputKind", result.inputKind) },
          { label: "결과", value: displayEnumValue("resultKind", result.resultKind) },
          { label: "파일", value: String(result.fileCount) },
          { label: "후보", value: String(result.candidateCount) },
          { label: "이슈", value: summarizeJson(result.issues), tone: hasJsonContent(result.issues) ? "warning" : undefined },
          { label: "오류", value: result.error ?? "-", tone: result.error ? "warning" : "muted" }
        ],
        href: `/operations/${result.operationId}`,
        id: result.id,
        title: result.courseName
      })),
      tableName: "Drive 조회 결과",
      title: "Drive 조회 결과"
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0)
  };
}

function moneyValue(value: { toString(): string } | null) {
  if (!value) return "";

  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? String(parsed) : value.toString();
}

function editableCell(tableKey: string, field: string, value: string, tone?: DatabaseCellPreview["tone"]): DatabaseCellPreview {
  const editableField = getAdminEditableField(tableKey, field);

  if (!editableField) {
    return { label: field, value, tone };
  }

  const rawValue = value || "";

  return {
    editable: true,
    field,
    input: editableField.input,
    label: editableField.label,
    options: editableField.options ? editableField.options.map((option) => ({
      label: option ? displayEditableValue(editableField.field, option) : "비움",
      value: option
    })) : undefined,
    rawValue,
    tone,
    value: displayEditableValue(editableField.field, rawValue)
  };
}

function displayEditableValue(field: string, value: string) {
  if (!value) return "";

  return displayEnumValue(field, value);
}

function displayEnumValue(field: string, value: string) {
  return ADMIN_ENUM_LABELS[field]?.[value] ?? value;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(value);
}

function isoDateTime(value: Date | undefined) {
  return value?.toISOString() ?? "";
}

function shortId(value: string) {
  return value.length > 12 ? value.slice(0, 8) : value;
}

function summarizeJson(value: unknown) {
  if (!hasJsonContent(value)) return "-";
  if (Array.isArray(value)) return `${value.length}개 항목`;
  if (isObjectRecord(value)) return `${Object.keys(value).length}개 필드`;

  return String(value);
}

function hasJsonContent(value: unknown) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObjectRecord(value)) return Object.keys(value).length > 0;

  return String(value).trim().length > 0;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
