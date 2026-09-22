import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import type { OperationRepository } from "./operationRepository";
import type { CreateOperationInput, OperationSession, UpdateOperationInput } from "./operationTypes";
import { assertCreationReplay, creationOperationId, creationOperationPrefix } from "./operationCreationIdentity";
import { buildOperationMonth, deriveDateRangeFromEducationDates, deriveSessionDurationDays, deriveSessionDurationType, normalizeCourseId, summarizeOperations } from "./operationCalculations";
import { normalizeLookupName, selectCoursesByCompany, selectCoursesByCourseId, type CourseLookupRow } from "./courseLookup";
import { DEFAULT_TEAM_MEMBER_ROLE_ROSTER } from "./defaultTeamMemberRoster";
import type { TeamMemberRoleRoster } from "./teamMemberRepository";
import { DB_ARCHIVE_STATUS, DB_EDUCATION_FORMAT, DB_OPERATION_STATUS, DB_OPERATION_TYPE, DB_RESULT_REPORT_STATUS, DB_SATISFACTION_SURVEY_STATUS, normalizeVisibleText, normalizeName, nullableText, onsiteRequiredLabel, parseDateInput, resolveAssigneeText, toDateString, toOperationSession, type OperationSessionRow } from "./operationRowMapping";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongo, assertMongoOperationStoreReady, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { operationAuditRow } from "./mongoOperationAudit";

function money(value: number | null): string | null {
  if (value === null) return null;
  assertMongo(Number.isFinite(value) && /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(value)), "INVALID_MONEY");
  return value.toFixed(2);
}
function id(row: MongoRow): string { return row.id as string; }
const textFields: Partial<Record<keyof UpdateOperationInput, string>> = {
  avgSatisfaction: "avgSatisfaction", coach: "coachText", companyWikiLink: "companyWikiLink", costRaw: "costRaw", driveLink: "driveLink", educationDays: "educationDays", instructorSatisfaction: "instructorSatisfaction", instructors: "instructorsText", instructorWikiLink: "instructorWikiLink", ld: "ldName", lectureManagementLink: "lectureManagementLink", lectureManagementNote: "lectureManagementNote", om: "omName", onsiteOm: "onsiteOmName", operationDetail: "operationDetail", operationIssue: "operationIssue", omUpdate: "omUpdate", padletLink: "padletLink", region: "region", resultReportLink: "resultReportLink", roundNo: "roundNo", specialNotes: "specialNotes", timeText: "timeText"
};

/** Explicit opt-in parallel repository. The production repository factory deliberately never selects it. */
export class MongoOperationRepository implements OperationRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoOperationOptions): Promise<MongoOperationRepository> {
    const store = new MongoOperationStore(options);
    await assertMongoOperationStoreReady(store);
    return new MongoOperationRepository(store);
  }
  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    // Mongo's convenient API retries labeled transient/unknown commit errors. Unique upsert races
    // can instead return 11000; restart a fresh transaction and re-read the winning row/claim.
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoServerError) throw new MongoOperationError("DATABASE_TRANSACTION_FAILED");
        throw error;
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("RETRY_LIMIT");
  }
  private async write(model: string, row: MongoRow, previous: MongoRow | null, session: ClientSession): Promise<MongoRow> {
    const clean = completeMongoRow(model, row);
    const document = encodeMongoRuntimeDocument(model, clean);
    if (previous) {
      const result = await this.store.collection(model).replaceOne({ _id: id(previous) }, document, { session });
      assertMongo(result.matchedCount === 1, "ROW_DISAPPEARED");
    } else await this.store.collection(model).insertOne(document, { session });
    const audit = operationAuditRow(model, previous, clean);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
    return clean;
  }
  private async nextSequence(session: ClientSession): Promise<number> {
    const row = await this.store.collection("__counter").findOneAndUpdate({ _id: "Course.processSeq", value: { $lt: 2147483647 } }, { $inc: { value: 1 } }, { session, returnDocument: "after" });
    assertMongo(row && Number.isInteger(row.value) && row.value > 0, "SEQUENCE_EXHAUSTED_OR_MISSING");
    return row.value;
  }
  private async course(companyId: string, courseId: string, name: string, patch: MongoRow, session: ClientSession, createFrom: MongoRow = {}): Promise<MongoRow> {
    const previous = await this.store.one("Course", { companyId, courseId, name }, session);
    if (previous) {
      if (!Object.keys(patch).length) return previous;
      return this.write("Course", { ...previous, ...patch, updatedAt: new Date() }, previous, session);
    }
    const now = new Date();
    return this.write("Course", { ...createFrom, ...patch, id: randomUUID(), processSeq: await this.nextSequence(session), companyId, courseId, name, createdAt: now, updatedAt: now }, null, session);
  }
  private async roleRoster(session: ClientSession): Promise<TeamMemberRoleRoster> {
    const rows = await this.store.scan("TeamUser", { role: { $ne: null } }, session);
    if (!rows.length) return DEFAULT_TEAM_MEMBER_ROLE_ROSTER;
    rows.sort((a,b) => String(a.role).localeCompare(String(b.role)) || String(a.team ?? "").localeCompare(String(b.team ?? "")) || String(a.name).localeCompare(String(b.name)));
    const roster: TeamMemberRoleRoster = { ld: {}, om: {} };
    for (const row of rows) {
      const role = row.role === "LD" ? "ld" : "om";
      const team = row.team === "1팀" || row.team === "2팀" ? row.team : "미분류";
      (roster[role][team] ??= []).push(row.name as string);
    }
    if (!Object.values(roster.om).some(names => names?.length)) roster.om = DEFAULT_TEAM_MEMBER_ROLE_ROSTER.om;
    return roster;
  }
  private async map(row: MongoRow, session?: ClientSession): Promise<OperationSession> {
    const course = await this.store.one("Course", { _id: row.courseRecordId as string }, session);
    assertMongo(course, "MISSING_COURSE");
    const company = await this.store.one("Company", { _id: course.companyId as string }, session);
    assertMongo(company, "MISSING_COMPANY");
    const label = await this.store.one("CourseIdLabel", { companyId: company.id, courseId: course.courseId }, session);
    const sources = await this.store.latestBy("OperationSourceRecord", "operationSessionId", [id(row)], "createdAt", session);
    return toOperationSession({ ...row, course: { ...course, company }, sourceRecords: sources.slice(0,1) } as unknown as OperationSessionRow, label?.label as string ?? "");
  }
  private async get(operationId: string, session?: ClientSession): Promise<OperationSession | null> {
    const row = await this.store.one("OperationSession", { operationId, deletedAt: null }, session);
    return row ? this.map(row, session) : null;
  }
  async getOperationById(operationId: string) { return this.transaction(session => this.get(operationId, session)); }
  async listOperations(): Promise<OperationSession[]> {
    return this.transaction(async session => {
      const rows = await this.store.scan("OperationSession", { deletedAt: null }, session);
      rows.sort((a,b) => (a.startDate as Date).getTime() - (b.startDate as Date).getTime() || String(a.operationId).localeCompare(String(b.operationId)));
      if (!rows.length) return [];
      const courses = await this.store.scan("Course", { _id: { $in: [...new Set(rows.map(row => row.courseRecordId as string))] } }, session);
      const companyIds = [...new Set(courses.map(course => course.companyId as string))];
      const companies = await this.store.scan("Company", { _id: { $in: companyIds } }, session);
      const labelPairs = [...new Map(courses.map(course => [JSON.stringify([course.companyId, course.courseId]), { companyId: course.companyId, courseId: course.courseId }])).values()];
      const labels = await this.store.scan("CourseIdLabel", { $or: labelPairs }, session);
      const sources = await this.store.latestBy("OperationSourceRecord", "operationSessionId", rows.map(id), "createdAt", session);
      const courseMap = new Map(courses.map(course => [course.id, course]));
      const companyMap = new Map(companies.map(company => [company.id, company]));
      const labelMap = new Map(labels.map(label => [JSON.stringify([label.companyId, label.courseId]), label.label as string]));
      const latestSource = new Map<unknown, MongoRow>();
      for (const source of sources) {
        const previous = latestSource.get(source.operationSessionId);
        if (!previous || (source.createdAt as Date) > (previous.createdAt as Date)) latestSource.set(source.operationSessionId, source);
      }
      return rows.map(row => {
        const course = courseMap.get(row.courseRecordId);
        assertMongo(course, "MISSING_COURSE");
        const company = companyMap.get(course.companyId);
        assertMongo(company, "MISSING_COMPANY");
        const source = latestSource.get(row.id);
        return toOperationSession({ ...row, course: { ...course, company }, sourceRecords: source ? [source] : [] } as unknown as OperationSessionRow, labelMap.get(JSON.stringify([course.companyId, course.courseId])) ?? "");
      });
    });
  }
  private async lookupRows(session: ClientSession): Promise<CourseLookupRow[]> {
    const courses = await this.store.scan("Course", {}, session);
    if (!courses.length) return [];
    const companies = new Map((await this.store.scan("Company", { _id: { $in: [...new Set(courses.map(course => course.companyId as string))] } }, session)).map(company => [company.id, company]));
    const sessions = await this.store.latestBy("OperationSession", "courseRecordId", courses.map(id), "startDate", session);
    const latestDates = new Map<unknown, Date>();
    for (const row of sessions) {
      const previous = latestDates.get(row.courseRecordId);
      if (!previous || (row.startDate as Date) > previous) latestDates.set(row.courseRecordId, row.startDate as Date);
    }
    const result: CourseLookupRow[] = [];
    for (const course of courses) {
      const company = companies.get(course.companyId);
      assertMongo(company, "MISSING_COMPANY");
      const date = latestDates.get(course.id);
      result.push({ companyName: company.name as string, courseName: course.name as string, courseId: course.courseId as string, latestStartDate: date ? toDateString(date) : null });
    }
    return result;
  }
  async findCoursesByCourseId(courseId: string) {
    const target = normalizeCourseId(courseId);
    if (!target) return [];
    return this.transaction(async session => selectCoursesByCourseId(await this.lookupRows(session), target));
  }
  async findCoursesByCompany(companyQuery: string, courseQuery: string, limit: number) {
    if (!normalizeLookupName(companyQuery)) return [];
    return this.transaction(async session => selectCoursesByCompany(await this.lookupRows(session), companyQuery, courseQuery, limit));
  }
  async createOperation(input: CreateOperationInput): Promise<OperationSession> {
    const companyName = normalizeVisibleText(input.companyName), courseName = normalizeVisibleText(input.courseName), courseId = normalizeVisibleText(input.courseId);
    assertMongo(companyName && courseName, "COMPANY_AND_COURSE_REQUIRED");
    const educationDates = (input.educationDates ?? []).map(date => parseDateInput(date, "educationDates"));
    const range = deriveDateRangeFromEducationDates(input.educationDates ?? []);
    const startDate = parseDateInput(range?.startDate ?? input.startDate, "startDate"), endDate = parseDateInput(range?.endDate ?? input.endDate, "endDate");
    assertMongo(startDate <= endDate, "INVALID_DATE_RANGE");
    const operationId = input.creationIdentity ? creationOperationId(input.creationIdentity) : `manual-${randomUUID()}`;
    return this.transaction(async session => {
      if (input.creationIdentity) {
        const identity = input.creationIdentity;
        const claim = await this.store.collection("__creation").findOne({ _id: identity.scope }, { session });
        // Imported PG rows predate Mongo claims. Check them before inserting a fresh claim.
        const existing = await this.store.one("OperationSession", claim ? { operationId: claim.operationId } : { operationId: { $regex: `^${creationOperationPrefix(identity)}` } }, session);
        assertMongo(!claim || existing, "ORPHAN_CREATION_CLAIM");
        if (existing) {
          assertCreationReplay(identity, { operationId: existing.operationId as string, deletedAt: existing.deletedAt });
          if (!claim) await this.store.collection("__creation").insertOne({ _id: identity.scope, operationId }, { session });
          return { ...await this.map(existing, session), creationReplayed: true };
        }
        await this.store.collection("__creation").insertOne({ _id: identity.scope, operationId }, { session });
      }
      const roster = await this.roleRoster(session);
      const now = new Date();
      const previousCompany = await this.store.one("Company", { normalizedName: normalizeName(companyName) }, session);
      const company = await this.write("Company", previousCompany ? { ...previousCompany, name: companyName, updatedAt: now } : { id: randomUUID(), name: companyName, normalizedName: normalizeName(companyName), createdAt: now, updatedAt: now }, previousCompany, session);
      const operationType = DB_OPERATION_TYPE[input.operationType];
      const course = await this.course(id(company), courseId, courseName, { operationType, revenue: money(input.revenue), revenueRaw: input.revenue === null ? null : String(input.revenue),
        ...(input.courseCategory !== undefined ? { courseCategory: nullableText(input.courseCategory) } : {}), ...(input.tools !== undefined ? { tools: nullableText(input.tools) } : {}) }, session);
      const row: MongoRow = { id: randomUUID(), operationId, courseRecordId: id(course), createdAt: now, updatedAt: now,
        archiveStatus: DB_ARCHIVE_STATUS[input.archiveStatus], operationStatus: DB_OPERATION_STATUS[input.operationStatus], educationFormat: DB_EDUCATION_FORMAT[input.educationFormat], educationFormatRaw: input.educationFormat,
        operationChannel: "NEEDS_REVIEW", startDate, endDate, educationDates, operationMonth: buildOperationMonth(toDateString(startDate)), sessionDurationDays: deriveSessionDurationDays(toDateString(startDate), toDateString(endDate)), sessionDurationType: operationType,
        hasResultReport: "NEEDS_REVIEW", hasSatisfactionSurvey: "NEEDS_REVIEW", onsiteRequired: input.onsiteRequired, onsiteText: onsiteRequiredLabel(input.onsiteRequired),
        createdBy: input.createdBy ?? null, updatedBy: input.createdBy ?? null, omName: resolveAssigneeText(input.om, "om", roster) || null, ldName: resolveAssigneeText(input.ld, "ld", roster) || null,
        totalCost: money(input.totalCost), instructorCost: money(input.instructorCost), operationCost: money(input.operationCost)
      };
      for (const [key, field] of Object.entries(textFields)) {
        if (key === "om" || key === "ld") continue;
        const value = input[key as keyof CreateOperationInput];
        if (typeof value === "string") row[field] = nullableText(value);
      }
      return this.map(await this.write("OperationSession", row, null, session), session);
    });
  }
  async updateOperation(operationId: string, input: UpdateOperationInput, updatedBy?: string): Promise<OperationSession> {
    return this.transaction(async session => {
      const previous = await this.store.one("OperationSession", { operationId, deletedAt: null }, session);
      assertMongo(previous, "OPERATION_NOT_FOUND");
      const currentCourse = await this.store.one("Course", { _id: previous.courseRecordId as string }, session);
      assertMongo(currentCourse, "MISSING_COURSE");
      let course = currentCourse;
      const next: MongoRow = { ...previous };
      if (input.courseId !== undefined || input.courseName !== undefined) {
        const courseId = input.courseId === undefined ? currentCourse.courseId as string : normalizeVisibleText(input.courseId);
        const name = input.courseName === undefined ? currentCourse.name as string : normalizeVisibleText(input.courseName);
        assertMongo((input.courseId === undefined || courseId) && name, "COURSE_ID_AND_NAME_REQUIRED");
        course = await this.course(currentCourse.companyId as string, courseId, name, {}, session, currentCourse);
        next.courseRecordId = id(course);
      }
      if (input.courseCategory !== undefined || input.tools !== undefined) {
        course = await this.write("Course", { ...course, ...(input.courseCategory !== undefined ? { courseCategory: nullableText(input.courseCategory) } : {}), ...(input.tools !== undefined ? { tools: nullableText(input.tools) } : {}), updatedAt: new Date() }, course, session);
      }
      if (input.courseIdLabel !== undefined) {
        const filter = { companyId: course.companyId, courseId: course.courseId };
        const previousLabel = await this.store.one("CourseIdLabel", filter, session);
        const now = new Date();
        await this.write("CourseIdLabel", { ...(previousLabel ?? { id: randomUUID(), createdAt: now, ...filter }), label: normalizeVisibleText(input.courseIdLabel), updatedAt: now }, previousLabel, session);
      }
      for (const [key, field] of Object.entries(textFields)) {
        const value = input[key as keyof UpdateOperationInput];
        if (typeof value === "string") next[field] = nullableText(value);
      }
      if (input.archiveStatus !== undefined) next.archiveStatus = DB_ARCHIVE_STATUS[input.archiveStatus];
      if (input.educationFormat !== undefined) next.educationFormat = DB_EDUCATION_FORMAT[input.educationFormat];
      if (input.operationStatus !== undefined) next.operationStatus = DB_OPERATION_STATUS[input.operationStatus];
      if (input.hasResultReport !== undefined) next.hasResultReport = DB_RESULT_REPORT_STATUS[input.hasResultReport];
      if (input.hasSatisfactionSurvey !== undefined) next.hasSatisfactionSurvey = DB_SATISFACTION_SURVEY_STATUS[input.hasSatisfactionSurvey];
      if (input.onsiteRequired !== undefined) { next.onsiteRequired = input.onsiteRequired; next.onsiteText = onsiteRequiredLabel(input.onsiteRequired); }
      for (const field of ["instructorCost", "operationCost", "totalCost"] as const) if (input[field] !== undefined) next[field] = money(input[field]);
      if (input.startDate !== undefined || input.endDate !== undefined || input.educationDates !== undefined) {
        const range = input.educationDates === undefined ? null : deriveDateRangeFromEducationDates(input.educationDates);
        next.startDate = parseDateInput(range?.startDate ?? input.startDate ?? toDateString(previous.startDate as Date), "startDate");
        next.endDate = parseDateInput(range?.endDate ?? input.endDate ?? toDateString(previous.endDate as Date), "endDate");
        assertMongo((next.startDate as Date) <= (next.endDate as Date), "INVALID_DATE_RANGE");
        next.operationMonth = buildOperationMonth(toDateString(next.startDate as Date));
        const days = deriveSessionDurationDays(toDateString(next.startDate as Date), toDateString(next.endDate as Date));
        next.sessionDurationDays = days; next.sessionDurationType = DB_OPERATION_TYPE[deriveSessionDurationType(days)];
        if (input.educationDates !== undefined) next.educationDates = input.educationDates.map(date => parseDateInput(date, "educationDates"));
      }
      if (Object.values(input).some(value => value !== undefined)) {
        next.updatedAt = new Date();
        if (updatedBy !== undefined) next.updatedBy = nullableText(updatedBy);
        await this.write("OperationSession", next, previous, session);
      }
      return this.map(next, session);
    });
  }
  async deleteOperation(operationId: string, deletedBy?: string): Promise<void> {
    await this.transaction(async session => {
      const previous = await this.store.one("OperationSession", { operationId, deletedAt: null }, session);
      assertMongo(previous, "OPERATION_NOT_FOUND");
      await this.write("OperationSession", { ...previous, deletedAt: new Date(), deletedBy: deletedBy ?? null, updatedAt: new Date() }, previous, session);
    });
  }
  async getSummary() { return summarizeOperations(await this.listOperations()); }
}
