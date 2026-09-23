import { encodePrivateJson, decodePrivateJson } from "@/lib/privacy/crypto";
import { assertCreationReplay, creationOperationId, creationOperationPrefix, OperationCreationConflict } from "./operationCreationIdentity";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  buildOperationMonth,
  deriveDateRangeFromEducationDates,
  deriveSessionDurationDays,
  deriveSessionDurationType,
  normalizeCourseId,
  summarizeOperations
} from "./operationCalculations";
import { normalizeLookupName, selectCoursesByCompany } from "./courseLookup";
import type { OperationRepository } from "./operationRepository";
import type {
  CourseLookupCandidate,
  CreateOperationInput,
  OperationSession,
  UpdateOperationInput
} from "./operationTypes";

interface LocalOperationPayload {
  operations: OperationSession[];
  creationReceipts: Record<string, string>;
}

const localWrites = new Map<string, Promise<unknown>>();

export class LocalJsonOperationRepository implements OperationRepository {
  private readonly fileName: string;

  constructor(fileName = process.env.OPERATION_DATA_FILE ?? "operations.json") {
    this.fileName = fileName;
  }

  private async serializeWrite<T>(run: () => Promise<T>): Promise<T> {
    const key = this.getLocalFilePath().absolutePath;
    const previous = localWrites.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(run);
    localWrites.set(key, current);
    try {
      return await current;
    } finally {
      if (localWrites.get(key) === current) localWrites.delete(key);
    }
  }

  private async readPayload(): Promise<LocalOperationPayload> {
    let raw: string;
    try {
      raw = await readFile(this.getLocalFilePath().absolutePath, "utf8");
    } catch (error) {
      if (isFileMissingError(error)) return { operations: [], creationReceipts: {} };
      throw error;
    }

    const parsed: unknown = decodePrivateJson(raw.trimEnd(), "local:operations");
    if (Array.isArray(parsed)) return { operations: parsed, creationReceipts: {} };
    if (!parsed || typeof parsed !== "object" || !("operations" in parsed) || !Array.isArray(parsed.operations)) {
      throw new Error("Local operation data must be an array or an object with an operations array.");
    }

    const receipts = "creationReceipts" in parsed ? parsed.creationReceipts : {};
    if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)) {
      throw new Error("Local operation creation receipts are invalid.");
    }
    const creationReceipts: Record<string, string> = {};
    for (const [scope, operationId] of Object.entries(receipts)) {
      if (!/^[a-f0-9]{64}$/.test(scope) || typeof operationId !== "string" ||
          !new RegExp(`^manual-request-${scope}-[a-f0-9]{64}$`).test(operationId)) {
        throw new Error("Local operation creation receipts are invalid.");
      }
      creationReceipts[scope] = operationId;
    }
    return { operations: parsed.operations, creationReceipts };
  }

  private async readCreationReceipts(): Promise<Record<string, string>> {
    return (await this.readPayload()).creationReceipts;
  }

  private async writeOperations(operations: OperationSession[], receipt?: { scope: string; operationId: string }): Promise<void> {
    const previous = await this.readPayload();
    const creationReceipts = previous.creationReceipts;
    const preserveReceipt = (scope: string, operationId: string) => {
      if (creationReceipts[scope] && creationReceipts[scope] !== operationId) {
        throw new OperationCreationConflict();
      }
      creationReceipts[scope] = operationId;
    };
    // 삭제·수정 전 행에서 복구해 이전 파일에서도 삭제된 요청의 이력을 남긴다.
    for (const operation of previous.operations) {
      const requestId = /^manual-request-([a-f0-9]{64})-([a-f0-9]{64})$/.exec(operation.operationId);
      if (requestId) preserveReceipt(requestId[1], operation.operationId);
    }
    if (receipt) preserveReceipt(receipt.scope, receipt.operationId);
    // 암호화가 실패하면 기존 파일뿐 아니라 임시 파일도 만들지 않는다.
    const encrypted = encodePrivateJson({ operations, creationReceipts }, "local:operations");
    const { absolutePath } = this.getLocalFilePath();
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
    const temporaryFile = await open(temporaryPath, "wx", 0o600);
    try {
      try {
        await temporaryFile.chmod(0o600);
        await temporaryFile.writeFile(encrypted, "utf8");
        await temporaryFile.sync();
      } finally {
        await temporaryFile.close();
      }
      // 같은 디렉터리에서 교체하여 읽는 쪽에 부분 파일이 보이지 않게 한다.
      // 기존 파일의 권한과 관계없이 새 암호문 파일은 0600이다.
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async listOperations(): Promise<OperationSession[]> {
    const { operations } = await this.readPayload();

    // 새 필드가 생기기 전에 저장된 로컬 픽스처 데이터에는 그 키가 아예 없다.
    // Postgres는 마이그레이션이 기존 행을 기본값으로 채워주지만, 로컬 JSON은 그런 백필이
    // 없으니 읽을 때 직접 채워 화면 쪽에서 항상 값이 있다고 가정할 수 있게 한다.
    // (예: lectureManagementNote가 없으면 운영 상세의 .trim()에서 바로 500이 난다.)
    return [...operations]
      .map((operation) => ({
        ...operation,
        companyId: operation.companyId ?? "",
        courseCategory: operation.courseCategory ?? "",
        courseIdLabel: operation.courseIdLabel ?? "",
        courseRecordId: operation.courseRecordId ?? "",
        educationDates: operation.educationDates ?? [],
        hasSatisfactionSurvey: operation.hasSatisfactionSurvey ?? "확인필요",
        lectureManagementNote: operation.lectureManagementNote ?? "",
        onsiteOm: operation.onsiteOm ?? "",
        processId: operation.processId ?? "",
        tools: operation.tools ?? ""
      }))
      .sort(compareOperationSessions);
  }

  /** 코스ID로 과정을 찾는다 — 로컬 JSON에는 회차만 있어 과정 단위로 묶어 낸다. */
  async findCoursesByCourseId(courseId: string): Promise<CourseLookupCandidate[]> {
    const target = normalizeCourseId(courseId);
    if (!target) return [];

    const byCourse = new Map<string, CourseLookupCandidate>();

    for (const operation of await this.listOperations()) {
      if (normalizeCourseId(operation.courseId) !== target) continue;

      const key = `${operation.companyName}|${operation.courseName}`;
      const previous = byCourse.get(key);
      const latestStartDate =
        previous?.latestStartDate && previous.latestStartDate > operation.startDate
          ? previous.latestStartDate
          : operation.startDate || null;

      byCourse.set(key, {
        courseId: target,
        companyName: operation.companyName,
        courseName: operation.courseName,
        latestStartDate
      });
    }

    return [...byCourse.values()].sort((a, b) => {
      if (a.latestStartDate !== b.latestStartDate) {
        if (!a.latestStartDate) return 1;
        if (!b.latestStartDate) return -1;
        return b.latestStartDate.localeCompare(a.latestStartDate);
      }

      return a.courseName.localeCompare(b.courseName);
    });
  }

  async findCoursesByCompany(companyQuery: string, courseQuery: string, limit: number): Promise<CourseLookupCandidate[]> {
    if (!normalizeLookupName(companyQuery)) return [];

    // 같은 과정의 여러 회차를 한 줄로 접고(가장 최근 강의일정만 남김), 고르기는 순수 함수에 맡긴다.
    const byCourse = new Map<string, { courseId: string; companyName: string; courseName: string; latestStartDate: null | string }>();

    for (const operation of await this.listOperations()) {
      const key = `${operation.companyName}|${operation.courseName}`;
      const previous = byCourse.get(key);
      const latestStartDate =
        previous?.latestStartDate && previous.latestStartDate > operation.startDate
          ? previous.latestStartDate
          : operation.startDate || null;

      byCourse.set(key, {
        courseId: operation.courseId,
        companyName: operation.companyName,
        courseName: operation.courseName,
        latestStartDate
      });
    }

    return selectCoursesByCompany([...byCourse.values()], companyQuery, courseQuery, limit);
  }

  async getOperationById(operationId: string): Promise<OperationSession | null> {
    const operations = await this.listOperations();
    return operations.find((operation) => operation.operationId === operationId) ?? null;
  }

  async createOperation(input: CreateOperationInput): Promise<OperationSession> {
    return this.serializeWrite(() => this.createOperationUnlocked(input));
  }

  private async createOperationUnlocked(input: CreateOperationInput): Promise<OperationSession> {
    const operations = await this.listOperations();
    const educationDates = input.educationDates ?? [];
    const derivedRange = deriveDateRangeFromEducationDates(educationDates);
    const startDate = derivedRange?.startDate ?? normalizeVisibleText(input.startDate);
    const endDate = derivedRange?.endDate ?? normalizeVisibleText(input.endDate);
    const operationId = input.creationIdentity ? creationOperationId(input.creationIdentity) : `manual-${randomUUID()}`;
    if (input.creationIdentity) {
      const previousId = (await this.readCreationReceipts())[input.creationIdentity.scope];
      if (previousId) {
        const existing = operations.find((operation) => operation.operationId === previousId);
        assertCreationReplay(input.creationIdentity, { operationId: previousId, deletedAt: !existing });
        return { ...existing!, creationReplayed: true };
      }
      // 이전 operations-only 파일에 남은 요청 ID로 영수증을 복구한다.
      // 같은 범위가 여러 행이면 임의로 고르거나 새 행을 만들지 않는다.
      const prefix = creationOperationPrefix(input.creationIdentity);
      const existing = operations.filter((operation) => operation.operationId.startsWith(prefix));
      if (existing.length > 1) throw new OperationCreationConflict();
      if (existing.length === 1) {
        assertCreationReplay(input.creationIdentity, existing[0]);
        await this.writeOperations(operations, { scope: input.creationIdentity.scope, operationId });
        return { ...existing[0], creationReplayed: true };
      }
    }
    const revenue = input.revenue;
    const totalCost = input.totalCost;
    const operation: OperationSession = {
      archiveStatus: input.archiveStatus,
      avgSatisfaction: "",
      coach: normalizeVisibleText(input.coach),
      companyName: normalizeVisibleText(input.companyName),
      companyWikiLink: normalizeVisibleText(input.companyWikiLink),
      costRaw: normalizeVisibleText(input.costRaw),
      courseCategory: normalizeVisibleText(input.courseCategory ?? ""),
      courseId: normalizeVisibleText(input.courseId),
      courseIdLabel: "",
      courseName: normalizeVisibleText(input.courseName),
      driveLink: normalizeVisibleText(input.driveLink),
      educationDays: normalizeVisibleText(input.educationDays),
      educationDates,
      educationFormat: input.educationFormat,
      educationFormatRaw: input.educationFormat,
      endDate,
      hasResultReport: "확인필요",
      hasSatisfactionSurvey: "확인필요",
      id: operationId,
      instructorCost: input.instructorCost,
      instructorSatisfaction: "",
      instructorWikiLink: normalizeVisibleText(input.instructorWikiLink),
      instructors: normalizeVisibleText(input.instructors),
      ld: normalizeVisibleText(input.ld),
      lectureManagementLink: normalizeVisibleText(input.lectureManagementLink),
      lectureManagementNote: "",
      om: normalizeVisibleText(input.om),
      onsiteOm: "",
      onsiteRequired: input.onsiteRequired,
      onsiteText: onsiteRequiredLabel(input.onsiteRequired),
      operationChannel: "needs_review",
      operationCost: input.operationCost,
      operationDetail: normalizeVisibleText(input.operationDetail),
      operationId,
      operationIssue: normalizeVisibleText(input.operationIssue),
      operationMonth: startDate.slice(0, 7),
      operationStatus: input.operationStatus,
      operationType: input.operationType,
      operationTypeRaw: input.operationType,
      omUpdate: "",
      padletLink: normalizeVisibleText(input.padletLink),
      profit: revenue !== null && totalCost !== null ? revenue - totalCost : null,
      profitRaw: "",
      region: normalizeVisibleText(input.region),
      resultReportLink: normalizeVisibleText(input.resultReportLink),
      revenue,
      roundNo: normalizeVisibleText(input.roundNo),
      sessionDurationDays: sessionDurationDays(startDate, endDate),
      sessionDurationType: input.operationType,
      specialNotes: normalizeVisibleText(input.specialNotes),
      startDate,
      timeText: normalizeVisibleText(input.timeText),
      tools: normalizeVisibleText(input.tools ?? ""),
      totalCost,
      validationErrors: [],
      validationStatus: "정상"
    };
    await this.writeOperations([...operations, operation], input.creationIdentity ? { scope: input.creationIdentity.scope, operationId } : undefined);

    return operation;
  }

  async updateOperation(operationId: string, input: UpdateOperationInput): Promise<OperationSession> {
    return this.serializeWrite(() => this.updateOperationUnlocked(operationId, input));
  }

  private async updateOperationUnlocked(operationId: string, input: UpdateOperationInput): Promise<OperationSession> {
    const operations = await this.listOperations();
    const operation = operations.find((candidate) => candidate.operationId === operationId);

    if (!operation) {
      throw new Error("Operation not found.");
    }

    const totalCost = input.totalCost === undefined ? operation.totalCost : input.totalCost;
    const derivedRange =
      input.educationDates !== undefined ? deriveDateRangeFromEducationDates(input.educationDates) : null;
    const startDate = derivedRange?.startDate ?? input.startDate ?? operation.startDate;
    const endDate = derivedRange?.endDate ?? input.endDate ?? operation.endDate;
    const sessionDurationDays = deriveSessionDurationDays(startDate, endDate);
    const updatedOperation: OperationSession = {
      ...operation,
      archiveStatus: input.archiveStatus ?? operation.archiveStatus,
      avgSatisfaction: normalizeOptionalText(input.avgSatisfaction, operation.avgSatisfaction),
      coach: normalizeOptionalText(input.coach, operation.coach),
      companyWikiLink: normalizeOptionalText(input.companyWikiLink, operation.companyWikiLink),
      costRaw: normalizeOptionalText(input.costRaw, operation.costRaw),
      courseCategory: normalizeOptionalText(input.courseCategory, operation.courseCategory),
      courseId: normalizeOptionalText(input.courseId, operation.courseId),
      courseIdLabel: normalizeOptionalText(input.courseIdLabel, operation.courseIdLabel),
      courseName: normalizeOptionalText(input.courseName, operation.courseName),
      driveLink: normalizeOptionalText(input.driveLink, operation.driveLink),
      educationDays: normalizeOptionalText(input.educationDays, operation.educationDays),
      educationDates: input.educationDates ?? operation.educationDates,
      educationFormat: input.educationFormat ?? operation.educationFormat,
      endDate,
      hasResultReport: input.hasResultReport ?? operation.hasResultReport,
      hasSatisfactionSurvey: input.hasSatisfactionSurvey ?? operation.hasSatisfactionSurvey,
      instructorCost: input.instructorCost === undefined ? operation.instructorCost : input.instructorCost,
      instructorSatisfaction: normalizeOptionalText(input.instructorSatisfaction, operation.instructorSatisfaction),
      instructors: normalizeOptionalText(input.instructors, operation.instructors),
      instructorWikiLink: normalizeOptionalText(input.instructorWikiLink, operation.instructorWikiLink),
      ld: normalizeOptionalText(input.ld, operation.ld),
      lectureManagementLink: normalizeOptionalText(input.lectureManagementLink, operation.lectureManagementLink),
      lectureManagementNote: normalizeOptionalText(input.lectureManagementNote, operation.lectureManagementNote),
      om: normalizeOptionalText(input.om, operation.om),
      onsiteOm: normalizeOptionalText(input.onsiteOm, operation.onsiteOm),
      onsiteRequired: input.onsiteRequired ?? operation.onsiteRequired,
      onsiteText: input.onsiteRequired ? onsiteRequiredLabel(input.onsiteRequired) : operation.onsiteText,
      operationCost: input.operationCost === undefined ? operation.operationCost : input.operationCost,
      operationDetail: normalizeOptionalText(input.operationDetail, operation.operationDetail),
      operationIssue: normalizeOptionalText(input.operationIssue, operation.operationIssue),
      operationStatus: input.operationStatus ?? operation.operationStatus,
      operationMonth: buildOperationMonth(startDate),
      omUpdate: normalizeOptionalText(input.omUpdate, operation.omUpdate),
      padletLink: normalizeOptionalText(input.padletLink, operation.padletLink),
      profit: operation.revenue !== null && totalCost !== null ? operation.revenue - totalCost : null,
      region: normalizeOptionalText(input.region, operation.region),
      resultReportLink: normalizeOptionalText(input.resultReportLink, operation.resultReportLink),
      roundNo: normalizeOptionalText(input.roundNo, operation.roundNo),
      sessionDurationDays,
      sessionDurationType: deriveSessionDurationType(sessionDurationDays),
      specialNotes: normalizeOptionalText(input.specialNotes, operation.specialNotes),
      startDate,
      timeText: normalizeOptionalText(input.timeText, operation.timeText),
      tools: normalizeOptionalText(input.tools, operation.tools),
      totalCost
    };
    // 코스ID명은 courseId 하나당 라벨 하나를 공유한다(Prisma 경로의 CourseIdLabel과 같은 의미).
    // 로컬 JSON에는 별도 테이블이 없어, 같은 회사+코스ID를 쓰는 모든 행에 그대로 복제해 흉내낸다.
    const sharedCourseIdLabel =
      input.courseIdLabel !== undefined ? normalizeOptionalText(input.courseIdLabel, operation.courseIdLabel) : null;
    const nextOperations = operations.map((candidate) => {
      if (candidate.operationId === operationId) return updatedOperation;
      if (
        sharedCourseIdLabel !== null &&
        normalizeCourseId(candidate.courseId) === normalizeCourseId(operation.courseId) &&
        candidate.companyName === operation.companyName
      ) {
        return { ...candidate, courseIdLabel: sharedCourseIdLabel };
      }
      return candidate;
    });
    await this.writeOperations(nextOperations);

    return updatedOperation;
  }

  async deleteOperation(operationId: string): Promise<void> {
    return this.serializeWrite(() => this.deleteOperationUnlocked(operationId));
  }

  private async deleteOperationUnlocked(operationId: string): Promise<void> {
    const operations = await this.listOperations();
    const nextOperations = operations.filter((candidate) => candidate.operationId !== operationId);
    await this.writeOperations(nextOperations);
  }

  async getSummary() {
    return summarizeOperations(await this.listOperations());
  }

  private getLocalFilePath() {
    const localDir = path.join(process.cwd(), ".local");
    const localFileName = path.normalize(this.fileName.replace(/^\.local[\/\\]/, ""));
    const absolutePath = path.resolve(localDir, localFileName);

    if (!absolutePath.startsWith(`${localDir}${path.sep}`)) {
      throw new Error(`OPERATION_DATA_FILE must resolve inside ${localDir}.`);
    }

    return { absolutePath, localDir };
  }
}

function isFileMissingError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function compareOperationSessions(a: OperationSession, b: OperationSession): number {
  if (a.startDate === b.startDate) {
    return a.operationId.localeCompare(b.operationId);
  }

  return a.startDate.localeCompare(b.startDate);
}

function normalizeVisibleText(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim().replace(/[^\S\n]+/g, " "))
    .join("\n")
    .trim();
}

function normalizeOptionalText(value: string | undefined, fallback: string) {
  return value === undefined ? fallback : normalizeVisibleText(value);
}

function sessionDurationDays(startValue: string, endValue: string): number | null {
  const start = parseDateInput(startValue);
  const end = parseDateInput(endValue);

  if (!start || !end) return null;

  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function parseDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }

  return date;
}

function onsiteRequiredLabel(value: OperationSession["onsiteRequired"]) {
  if (value === "Y") return "오프라인";
  if (value === "N") return "온라인";
  if (value === "PARTIAL") return "일부 오프라인";
  return "검토필요";
}
