import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildOperationMonth,
  deriveSessionDurationDays,
  deriveSessionDurationType,
  normalizeCourseId,
  summarizeOperations
} from "./operationCalculations";
import type { OperationRepository } from "./operationRepository";
import type {
  CourseLookupCandidate,
  CreateOperationInput,
  OperationSession,
  UpdateOperationInput
} from "./operationTypes";

interface LocalOperationPayload {
  operations?: OperationSession[];
}

export class LocalJsonOperationRepository implements OperationRepository {
  constructor(private readonly fileName = process.env.OPERATION_DATA_FILE ?? "operations.json") {}

  async listOperations(): Promise<OperationSession[]> {
    const { absolutePath } = this.getLocalFilePath();

    try {
      const raw = await readFile(absolutePath, "utf8");
      const parsed = JSON.parse(raw) as LocalOperationPayload | OperationSession[];
      const operations = Array.isArray(parsed) ? parsed : parsed.operations;

      if (!Array.isArray(operations)) {
        throw new Error("Local operation data must be an array or an object with an operations array.");
      }

      return [...operations].sort(compareOperationSessions);
    } catch (error) {
      if (isFileMissingError(error)) {
        return [];
      }

      throw error;
    }
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

  async getOperationById(operationId: string): Promise<OperationSession | null> {
    const operations = await this.listOperations();
    return operations.find((operation) => operation.operationId === operationId) ?? null;
  }

  async createOperation(input: CreateOperationInput): Promise<OperationSession> {
    const operations = await this.listOperations();
    const startDate = normalizeVisibleText(input.startDate);
    const endDate = normalizeVisibleText(input.endDate);
    const operationId = `manual-${randomUUID()}`;
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
      courseName: normalizeVisibleText(input.courseName),
      driveLink: normalizeVisibleText(input.driveLink),
      educationDays: normalizeVisibleText(input.educationDays),
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
    const { absolutePath, localDir } = this.getLocalFilePath();

    await mkdir(localDir, { recursive: true });
    await writeFile(absolutePath, `${JSON.stringify({ operations: [...operations, operation] }, null, 2)}\n`, "utf8");

    return operation;
  }

  async updateOperation(operationId: string, input: UpdateOperationInput): Promise<OperationSession> {
    const operations = await this.listOperations();
    const operation = operations.find((candidate) => candidate.operationId === operationId);

    if (!operation) {
      throw new Error("Operation not found.");
    }

    const totalCost = input.totalCost === undefined ? operation.totalCost : input.totalCost;
    const startDate = input.startDate ?? operation.startDate;
    const endDate = input.endDate ?? operation.endDate;
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
      courseName: normalizeOptionalText(input.courseName, operation.courseName),
      driveLink: normalizeOptionalText(input.driveLink, operation.driveLink),
      educationDays: normalizeOptionalText(input.educationDays, operation.educationDays),
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
      sessionDurationDays,
      sessionDurationType: deriveSessionDurationType(sessionDurationDays),
      specialNotes: normalizeOptionalText(input.specialNotes, operation.specialNotes),
      startDate,
      timeText: normalizeOptionalText(input.timeText, operation.timeText),
      tools: normalizeOptionalText(input.tools, operation.tools),
      totalCost
    };
    const nextOperations = operations.map((candidate) =>
      candidate.operationId === operationId ? updatedOperation : candidate
    );
    const { absolutePath, localDir } = this.getLocalFilePath();

    await mkdir(localDir, { recursive: true });
    await writeFile(absolutePath, `${JSON.stringify({ operations: nextOperations }, null, 2)}\n`, "utf8");

    return updatedOperation;
  }

  async deleteOperation(operationId: string): Promise<void> {
    const operations = await this.listOperations();
    const nextOperations = operations.filter((candidate) => candidate.operationId !== operationId);
    const { absolutePath, localDir } = this.getLocalFilePath();

    await mkdir(localDir, { recursive: true });
    await writeFile(absolutePath, `${JSON.stringify({ operations: nextOperations }, null, 2)}\n`, "utf8");
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
