import { BSON, type ClientSession, type Filter } from "mongodb";
import type { ActivityReadRepository, ActivityFilters, ActivityFeedFilters, ActivityUsageFilters, ActivityLegacyWhere, ActivityRequestRow, ActivityChangeRow, ActivityPage, LegacyActivityRow, ActivitySummary } from "./activityReads/activityReadRepository";
import { changedText, formatActivityChanges, type ActivityLabelRows } from "../activity/presentation";
import { legacyAction } from "../activity/legacy";
import { monitoringRoutes } from "../activity/usage";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull, type MongoRuntimeDocument } from "./mongoRuntimeCodec";

export const ACTIVITY_READ_MODELS = ["ActivityRequest", "ActivityChange", "CoachContentEntry", "Coach", "CoachEngagement", "OperationSession", "Course", "Company"] as const;
export type MongoActivityReadOptions = MongoOperationOptions;
type Row = Record<string, unknown>;
type Candidate = Filter<MongoRuntimeDocument>;
type Scope = { session: ClientSession; check: () => void; remaining: () => number };
export class MongoActivityReadError extends Error {
  readonly code: string;
  constructor(code = "ACTIVITY_READ_FAILED") { super(code); this.name = "MongoActivityReadError"; this.code = code; }
}
function requireValue(value: unknown, code = "ACTIVITY_READ_INVALID_FILTER"): asserts value {
  if (!value) throw new MongoActivityReadError(code);
}
function uuid(value: unknown): string {
  requireValue(typeof value === "string");
  // PostgreSQL UUID input permits braces, compact input, and separators after
  // groups of four hex digits. TargetId remains ordinary text elsewhere.
  const inner = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  requireValue(/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(inner));
  const hex = inner.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function object(value: unknown): Row {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date));
  return value as Row;
}

/** SQL LIKE patterns, not JavaScript substring matching. Each underscore consumes
 * one Unicode code point, including a newline. Escapes apply to the wrapped
 * pattern too (a trailing input backslash escapes the appended percent).
 */
function likePattern(input: string): string {
  const chars = Array.from(`%${input}%`);
  let pattern = "\\A";
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === "%") pattern += "[\\s\\S]*";
    else if (char === "_") pattern += "[\\s\\S]";
    else {
      const literal = char === "\\" ? chars[++i] : char;
      requireValue(literal !== undefined);
      pattern += literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return `${pattern}\\z`;
}
type Compiled = { candidate: Candidate; matches: (row: Row) => boolean; publicOnly: boolean };
/** Deliberately limited to predicates emitted by activity query/feed/usage/legacy.
 * Public predicates execute on the server; private contains remains literal JS.
 */
function compile(model: string, value: unknown, depth = 0): Compiled {
  requireValue(depth < 16);
  const where = object(value);
  const parts: Compiled[] = [];
  const allowed = model === "CoachContentEntry" ? ["id", "coachId", "createdAt", "kind", "content", "authorEmail"]
    : model === "ActivityRequest" ? ["id", "occurredAt", "actorEmail", "actorType", "route", "status"]
      : ["id", "occurredAt", "actorEmail", "actorType", "action", "targetType", "targetId", "requestId"];
  for (const [field, condition] of Object.entries(where)) {
    if (["AND", "OR", "NOT"].includes(field)) {
      const children = (Array.isArray(condition) ? condition : [condition]).map(child => compile(model, child, depth + 1));
      const publicOnly = children.every(child => child.publicOnly);
      let candidate: Candidate = {};
      if (field === "AND") {
        const safe = children.map(child => child.candidate).filter(child => Object.keys(child).length);
        if (safe.length) candidate = { $and: safe };
      } else if (field === "OR") {
        if (!children.length) candidate = { _id: { $in: [] } };
        else if (children.every(child => Object.keys(child.candidate).length)) candidate = { $or: children.map(child => child.candidate) };
      } else if (publicOnly && children.length) candidate = { $nor: children.map(child => child.candidate) };
      parts.push({ candidate, publicOnly, matches: row => field === "AND" ? children.every(child => child.matches(row))
        : field === "OR" ? children.some(child => child.matches(row)) : children.every(child => !child.matches(row)) });
      continue;
    }
    requireValue(allowed.includes(field));
    if (field === "actorEmail" || field === "authorEmail") {
      const filter = object(condition);
      const keys = Object.keys(filter);
      if (keys.length === 1 && filter.not === null) {
        parts.push({ candidate: { [`${field}PiiIndex`]: { $ne: null } }, publicOnly: true, matches: row => row[field] !== null });
      } else {
        requireValue(keys.every(key => key === "contains" || key === "mode") && typeof filter.contains === "string" && filter.mode === "insensitive");
        const needle = filter.contains.toLowerCase();
        parts.push({ candidate: {}, publicOnly: false, matches: row => typeof row[field] === "string" && (row[field] as string).toLowerCase().includes(needle) });
      }
      continue;
    }
    if (field === "content") {
      const filter = object(condition);
      requireValue(Object.keys(filter).length === 1 && typeof filter.startsWith === "string");
      const prefix = filter.startsWith;
      parts.push({ candidate: {}, publicOnly: false, matches: row => typeof row.content === "string" && row.content.startsWith(prefix) });
      continue;
    }
    const stored = field === "id" ? "_id" : field;
    const isUuid = ["id", "requestId", "coachId"].includes(field);
    let predicate: unknown;
    if (field === "occurredAt" || field === "createdAt") {
      if (condition instanceof Date) { requireValue(Number.isFinite(condition.getTime())); predicate = condition; }
      else {
        const filter = object(condition), operators: Row = {};
        for (const [op, date] of Object.entries(filter)) {
          requireValue(["gte", "lt"].includes(op) && date instanceof Date && Number.isFinite(date.getTime()));
          operators[`$${op}`] = date;
        }
        // Prisma accepts an empty date filter as no restriction.
        if (!Object.keys(operators).length) continue;
        predicate = operators;
      }
    } else if (typeof condition === "string") predicate = isUuid ? uuid(condition) : condition;
    else {
      const filter = object(condition), keys = Object.keys(filter);
      requireValue(keys.length === 1);
      if (isUuid && typeof filter.lt === "string") predicate = { $lt: uuid(filter.lt) };
      else if (field === "status" && Number.isInteger(filter.gte)) predicate = { $gte: filter.gte };
      else if (field === "route" && Array.isArray(filter.notIn) && filter.notIn.every(item => typeof item === "string")) predicate = { $nin: filter.notIn, $ne: null };
      else if (field === "route" && typeof filter.contains === "string") predicate = { $regex: likePattern(filter.contains) };
      else throw new MongoActivityReadError("ACTIVITY_READ_INVALID_FILTER");
    }
    // Candidate membership already checks these public predicates. For nested OR
    // involving private predicates, evaluate them again against authenticated rows.
    const matches = (row: Row): boolean => {
      const actual = row[field];
      if (predicate instanceof Date) return actual instanceof Date && actual.getTime() === predicate.getTime();
      if (typeof predicate === "string") return actual === predicate;
      const ops = predicate as Row;
      return Object.entries(ops).every(([op, expected]) => {
        const a = actual instanceof Date ? actual.getTime() : actual;
        const b = expected instanceof Date ? expected.getTime() : expected;
        if (op === "$lt") return typeof a === "number" && typeof b === "number" ? a < b : typeof a === "string" && typeof b === "string" && a < b;
        if (op === "$gte") return typeof a === "number" && typeof b === "number" && a >= b;
        if (op === "$ne") return actual !== expected;
        if (op === "$nin") return actual !== null && !(expected as unknown[]).includes(actual);
        if (op === "$regex") return typeof actual === "string" && sqlLike(actual, (condition as Row).contains as string);
        return false;
      });
    };
    parts.push({ candidate: { [stored]: predicate }, publicOnly: true, matches });
  }
  const candidates = parts.map(part => part.candidate).filter(part => Object.keys(part).length);
  return { candidate: candidates.length ? { $and: candidates } : {}, publicOnly: parts.every(part => part.publicOnly), matches: row => parts.every(part => part.matches(row)) };
}
function sqlLike(value: string, input: string): boolean {
  // A bounded dynamic program avoids regex backtracking on repeated wildcards.
  const pattern = Array.from(`%${input}%`);
  const tokens: { kind: "many" | "one" | "literal"; value?: string }[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "%") { if (tokens.at(-1)?.kind !== "many") tokens.push({ kind: "many" }); }
    else if (char === "_") tokens.push({ kind: "one" });
    else {
      const literal = char === "\\" ? pattern[++i] : char;
      requireValue(literal !== undefined);
      tokens.push({ kind: "literal", value: literal });
    }
  }
  let previous = new Uint8Array(tokens.length + 1); previous[0] = 1;
  for (let j = 1; j <= tokens.length; j++) if (tokens[j - 1].kind === "many") previous[j] = previous[j - 1];
  for (const char of value) {
    const next = new Uint8Array(tokens.length + 1);
    for (let j = 1; j <= tokens.length; j++) {
      const token = tokens[j - 1];
      next[j] = token.kind === "many" ? Number(Boolean(next[j - 1] || previous[j]))
        : Number(Boolean(previous[j - 1] && (token.kind === "one" || token.value === char)));
    }
    previous = next;
  }
  return Boolean(previous[tokens.length]);
}

function requestDto(row: Row): ActivityRequestRow {
  return { id: row.id, occurredAt: row.occurredAt, actorEmail: row.actorEmail, actorName: row.actorName, actorType: row.actorType,
    route: row.route, method: row.method, status: row.status, durationMs: row.durationMs } as ActivityRequestRow;
}
function changeDto(row: Row): ActivityChangeRow {
  return { id: row.id, occurredAt: row.occurredAt, requestId: row.requestId, actorEmail: row.actorEmail, actorName: row.actorName,
    actorType: row.actorType, route: row.route, method: row.method, targetType: row.targetType, targetId: row.targetId, action: row.action,
    changes: row.changes === MongoDbNull || row.changes === MongoJsonNull ? null : row.changes } as ActivityChangeRow;
}
function page<T extends { id: string; occurredAt: Date }>(rows: T[]): ActivityPage<T> {
  const entries = rows.slice(0, 50), last = entries.at(-1);
  return { entries, nextCursor: rows.length > 50 && last ? `${last.occurredAt.toISOString()}|${last.id}` : null };
}
function ordered(rows: Row[], field = "occurredAt"): Row[] {
  return rows.sort((a, b) => (b[field] as Date).getTime() - (a[field] as Date).getTime() || (a.id === b.id ? 0 : (a.id as string) < (b.id as string) ? 1 : -1));
}
export async function prepareMongoActivityReadStore(options: MongoOperationOptions & { allowShadowWrites: true }): Promise<void> {
  try { await prepareMongoReadStore(options, ACTIVITY_READ_MODELS); }
  catch { throw new MongoActivityReadError("ACTIVITY_READ_PREPARE_FAILED"); }
}
export class MongoActivityReadRepository implements ActivityReadRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoActivityReadOptions): Promise<MongoActivityReadRepository> {
    try {
      const store = new MongoOperationStore(options, ACTIVITY_READ_MODELS);
      const hello = await store.db.command({ hello: 1 });
      requireValue((typeof hello.setName === "string" && hello.setName.length > 0) && typeof hello.logicalSessionTimeoutMinutes === "number", "ACTIVITY_READ_TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoActivityReadRepository(store);
    } catch { throw new MongoActivityReadError("ACTIVITY_READ_OPEN_FAILED"); }
  }
  private async transaction<T>(work: (scope: Scope) => Promise<T>): Promise<T> {
    const deadline = performance.now() + 8_000;
    const check = () => requireValue(performance.now() < deadline, "ACTIVITY_READ_TIMEOUT");
    const remaining = () => { check(); return Math.max(1, Math.ceil(deadline - performance.now())); };
    try {
      const session = this.store.client.startSession();
      let result: T;
      try {
        result = await session.withTransaction(async () => {
          check(); const value = await work({ session, check, remaining }); check(); return value;
        }, { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: remaining() });
        check();
      } finally { await session.endSession(); }
      check();
      return result;
    } catch (error) {
      if (error instanceof MongoActivityReadError) throw error;
      throw new MongoActivityReadError();
    }
  }
  private async scan(model: string, filter: Candidate, scope: Scope): Promise<Row[]> {
    const deadline = performance.now() + 15_000;
    const rows: Row[] = [];
    let bytes = 0, last: string | undefined;
    while (true) {
      scope.check();
      requireValue(performance.now() < deadline, "ACTIVITY_READ_SCAN_TIMEOUT");
      const cursor = this.store.collection(model).find(last === undefined ? filter : { $and: [filter, { _id: { $gt: last } }] }, {
        session: scope.session, singleBatch: true, batchSize: 100,
        maxTimeMS: Math.min(scope.remaining(), Math.max(1, Math.ceil(deadline - performance.now()))), collation: { locale: "simple" }
      }).sort({ _id: 1 }).limit(100);
      let count = 0;
      try {
        for await (const document of cursor) {
          scope.check();
          bytes += BSON.calculateObjectSize(document);
          requireValue(rows.length < 20_000 && bytes <= 32 * 1024 * 1024, "ACTIVITY_READ_SCAN_LIMIT");
          rows.push(decodeMongoRuntimeDocument(model, document));
          scope.check(); last = document._id; count++;
        }
      } finally { await cursor.close(); }
      scope.check();
      if (!count) return rows;
    }
  }
  private async matching(model: string, where: unknown, scope: Scope): Promise<Row[]> {
    const filter = compile(model, where);
    const rows = await this.scan(model, filter.candidate, scope);
    const result = rows.filter(row => { scope.check(); return filter.matches(row); });
    scope.check(); return result;
  }
  private async labels(rows: ActivityChangeRow[], scope: Scope): Promise<ActivityLabelRows> {
    const ids = (kind: string) => rows.filter(row => row.targetType === kind && /^[0-9a-f-]{36}$/i.test(row.targetId)).map(row => uuid(row.targetId));
    const byIds = async (model: string, values: string[]) => values.length ? this.scan(model, { _id: { $in: [...new Set(values)] } }, scope) : [];
    const operationIds = rows.flatMap(row => row.targetType === "calendar_event_links" ? [changedText(row.changes, "operation_id")].filter((v): v is string => Boolean(v)) : []);
    const opIds = ids("operation_sessions");
    const operations = opIds.length || operationIds.length ? await this.scan("OperationSession", { $or: [{ _id: { $in: opIds } }, { operationId: { $in: operationIds } }] }, scope) : [];
    const coaches = await byIds("Coach", ids("coaches"));
    const courses = await byIds("Course", ids("courses"));
    const companies = await byIds("Company", ids("companies"));
    const notes = await byIds("CoachContentEntry", ids("coach_content_entries"));
    const engagements = await byIds("CoachEngagement", ids("coach_engagements"));
    const requiredCourses = await byIds("Course", operations.map(row => row.courseRecordId as string));
    const requiredCompanies = await byIds("Company", [...courses, ...requiredCourses].map(row => row.companyId as string));
    const requiredCoaches = await byIds("Coach", [...notes, ...engagements].map(row => row.coachId as string));
    const find = (values: Row[], id: unknown) => { const found = values.find(row => row.id === id); requireValue(found, "ACTIVITY_READ_MISSING_RELATION"); return found; };
    const coach = (row: Row) => ({ id: row.id as string, name: row.name as string, deletedAt: row.deletedAt as Date | null });
    const course = (row: Row) => ({ name: row.name as string, company: { name: find(requiredCompanies, row.companyId).name as string } });
    const result: ActivityLabelRows = {
      operations: operations.map(row => ({ id: row.id as string, operationId: row.operationId as string, roundNo: row.roundNo as string | null, course: course(find(requiredCourses, row.courseRecordId)) })),
      coaches: coaches.map(coach), courses: courses.map(row => ({ id: row.id as string, ...course(row) })),
      companies: companies.map(row => ({ id: row.id as string, name: row.name as string })),
      notes: notes.map(row => ({ id: row.id as string, coach: coach(find(requiredCoaches, row.coachId)) })),
      engagements: engagements.map(row => ({ id: row.id as string, coach: coach(find(requiredCoaches, row.coachId)) }))
    };
    scope.check(); return result;
  }
  async adminList(filters: ActivityFilters) {
    return this.transaction(async scope => {
      requireValue(filters.tab === "requests" || filters.tab === "changes");
      if (filters.tab === "requests") {
        const rows = ordered(await this.matching("ActivityRequest", { AND: [filters.requests, { route: { notIn: monitoringRoutes } }] }, scope));
        const result = page(rows.slice(0, 51).map(requestDto)); scope.check(); return result;
      }
      const rows = ordered(await this.matching("ActivityChange", filters.changes, scope));
      const selected = page(rows.slice(0, 51).map(changeDto));
      const entries = formatActivityChanges(selected.entries, await this.labels(selected.entries, scope));
      scope.check(); return { entries, nextCursor: selected.nextCursor };
    });
  }
  async legacyList(where: ActivityLegacyWhere): Promise<ActivityPage<LegacyActivityRow>> {
    return this.transaction(async scope => {
      if (where === null) return { entries: [], nextCursor: null };
      const rows = ordered(await this.matching("CoachContentEntry", where, scope), "createdAt").slice(0, 51);
      const coaches = rows.length ? await this.scan("Coach", { _id: { $in: [...new Set(rows.map(row => row.coachId as string))] } }, scope) : [];
      const entries: LegacyActivityRow[] = rows.map(row => {
        const coach = coaches.find(coach => coach.id === row.coachId);
        requireValue(coach, "ACTIVITY_READ_MISSING_RELATION");
        return { id: row.id as string, occurredAt: row.createdAt as Date, actorName: row.authorName as string | null, actorEmail: row.authorEmail as string | null,
          actorType: "user", targetType: "coaches", targetId: row.coachId as string, targetLabel: coach.name as string, labelSource: "현재 정보",
          targetHref: coach.deletedAt ? null : `/coaches/${row.coachId}`, action: legacyAction(row.content as string), description: row.content as string,
          legacy: true, changes: {}, route: row.sourceField as string | null, method: "" };
      });
      const result = page(entries); scope.check(); return result;
    });
  }
  private summary(requests: Row[], changes: Row[], scope: Scope): ActivitySummary {
    const users = new Set<string>(); let errors = 0;
    for (const row of requests) { scope.check(); if ((row.status as number) >= 400) errors++; if (row.actorEmail !== null) users.add(row.actorEmailPiiIndex as string); }
    return { requests: requests.length, changes: changes.length, errors, users: users.size };
  }
  async feed(filters: ActivityFeedFilters) {
    return this.transaction(async scope => {
      requireValue(filters.list.tab === "requests" || filters.list.tab === "changes");
      const requests = filters.list.tab === "requests";
      const rows = ordered(await this.matching(requests ? "ActivityRequest" : "ActivityChange", requests ? filters.list.requests : filters.list.changes, scope));
      const selected = page<ActivityRequestRow | ActivityChangeRow>(rows.slice(0, 51).map(row => requests ? requestDto(row) : changeDto(row)));
      let summary: ActivitySummary | undefined;
      if (filters.includeSummary) {
        const requestRows = await this.matching("ActivityRequest", filters.summary.requests, scope);
        const changeRows = await this.matching("ActivityChange", filters.summary.changes, scope);
        summary = this.summary(requestRows, changeRows, scope);
      }
      scope.check(); return { ...selected, summary, fetchedAt: new Date().toISOString() };
    });
  }
  async usage(filters: ActivityUsageFilters) {
    return this.transaction(async scope => {
      const human = await this.matching("ActivityRequest", filters.human, scope);
      const automated = await this.matching("ActivityRequest", filters.automated, scope);
      const changes = await this.matching("ActivityChange", { occurredAt: filters.occurredAt, actorType: "user" }, scope);
      const result = { ...this.summary(human, changes, scope), automatedRequests: automated.length };
      scope.check(); return result;
    });
  }
}
