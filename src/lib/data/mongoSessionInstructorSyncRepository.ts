// SessionInstructorSyncRepository의 라이브(Mongo-shadow) 구현. 코치 mongoSessionCoachSyncRepository 미러.
// 읽기(readInputs)는 스냅샷 읽기 트랜잭션, 쓰기(withWriter)는 강사 카탈로그 락을 잡은 쓰기 트랜잭션에서만.
// 쓰기는 반드시 writeRow(=completeMongoRow→encodeMongoRuntimeDocument 암호화/PII색인 + audit로 ActivityChange)를
// 거쳐야 Postgres의 확장(암호화·활동기록)과 동작이 같아진다. raw updateOne 금지.
import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import { activityContext } from "../activity/context";
import {
  assertMongo,
  completeMongoRow,
  MongoOperationError,
  MongoOperationStore,
  type MongoOperationOptions,
  type MongoRow
} from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongoInstructorCatalogGuardReady, lockMongoInstructorCatalog, prepareMongoInstructorCatalogGuard } from "./mongoInstructorCatalogGuard";
import type { SessionInstructorSyncInputs, SessionInstructorSyncRepository } from "./sessionInstructorSyncRepository";
import type { ExistingSessionInstructorEngagement } from "../instructors/sessionInstructorSync";
import type { SessionInstructorWriter, SyncInstructorSessionInput } from "../instructors/sessionInstructorSyncWorkflow";
import { applySessionInstructorsByIds, type ApplySessionInstructorsResult } from "../instructors/sessionInstructorSyncWorkflow";

// 읽기: Course(과정명 조인)·OperationSession·InstructorNote·InstructorEngagement. 쓰기: InstructorEngagement·InstructorEngagementSchedule·ActivityChange(감사).
export const SESSION_INSTRUCTOR_SYNC_MODELS = ["Course", "OperationSession", "InstructorNote", "InstructorEngagement", "InstructorEngagementSchedule", "ActivityChange"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
const TXN_TIMEOUT_MS = 60_000; // Postgres TXN_TIMEOUT_MS와 맞춤. 청크(50)당 트랜잭션 1개.
const READ_TIMEOUT_MS = 30_000;

/** 명시적 준비(open-only CLI는 쓰지 않음). 네임스페이스가 없을 때만 런타임이 호출한다. */
export async function prepareMongoSessionInstructorSyncStore(options: Options): Promise<void> {
  await prepareMongoReadStore(options, SESSION_INSTRUCTOR_SYNC_MODELS);
  await prepareMongoInstructorCatalogGuard(new MongoOperationStore(options, SESSION_INSTRUCTOR_SYNC_MODELS), options.allowShadowWrites);
}

export class MongoSessionInstructorSyncRepository implements SessionInstructorSyncRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: Options): Promise<MongoSessionInstructorSyncRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, SESSION_INSTRUCTOR_SYNC_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((hello.setName || hello.msg === "isdbgrid") && hello.logicalSessionTimeoutMinutes != null, "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoInstructorCatalogGuardReady(store);
      return new MongoSessionInstructorSyncRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("SESSION_INSTRUCTOR_SYNC_OPEN_FAILED");
    }
  }

  private async audit(model: string, before: MongoRow | null, after: MongoRow | null, session: ClientSession) {
    const row = operationAuditRow(model, before, after);
    if (row) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", row), { session });
  }

  /** 모든 비즈니스 쓰기는 이 경로로만: 암호화/PII색인(encode) + 감사(audit). before가 있으면 full-row replace. */
  private async writeRow(model: string, fields: MongoRow, before: MongoRow | null, session: ClientSession): Promise<MongoRow> {
    const row = completeMongoRow(model, fields), document = encodeMongoRuntimeDocument(model, row);
    if (before) {
      const result = await this.store.collection(model).replaceOne({ _id: document._id }, document, { session });
      assertMongo(result.matchedCount === 1, "SESSION_INSTRUCTOR_SYNC_ROW_DISAPPEARED");
    } else {
      await this.store.collection(model).insertOne(document, { session });
    }
    await this.audit(model, before, row, session);
    return row;
  }

  private writer(session: ClientSession): SessionInstructorWriter {
    const store = this.store;
    const previous = async (model: string, id: string): Promise<MongoRow> => {
      const row = await store.one(model, { _id: id }, session);
      assertMongo(row, "SESSION_INSTRUCTOR_SYNC_ROW_DISAPPEARED");
      return row;
    };
    const remove = async (model: string, row: MongoRow) => {
      await store.collection(model).deleteOne({ _id: row.id as string }, { session });
      await this.audit(model, row, null, session);
    };
    return {
      createEngagement: async (input) => {
        const id = randomUUID();
        await this.writeRow("InstructorEngagement", { id, ...input, createdAt: new Date() }, null, session);
        return { id };
      },
      replaceSchedules: async (engagementId, rows) => {
        // Postgres의 deleteMany+createMany를 감사 보존을 위해 per-row 삭제+생성으로 미러.
        for (const row of await store.scan("InstructorEngagementSchedule", { engagementId }, session)) await remove("InstructorEngagementSchedule", row);
        for (const row of rows) await this.writeRow("InstructorEngagementSchedule", { id: randomUUID(), ...row }, null, session);
      },
      convertToManual: async (ids) => {
        for (const id of ids) { const row = await previous("InstructorEngagement", id); await this.writeRow("InstructorEngagement", { ...row, source: "MANUAL" }, row, session); }
      },
      reactivateEngagements: async (ids, status) => {
        for (const id of ids) { const row = await previous("InstructorEngagement", id); await this.writeRow("InstructorEngagement", { ...row, status, source: "MANUAL" }, row, session); }
      },
      cancelEngagements: async (ids) => {
        for (const id of ids) { const row = await previous("InstructorEngagement", id); await this.writeRow("InstructorEngagement", { ...row, status: "CANCELLED" }, row, session); }
      }
    };
  }

  async readInputs(): Promise<SessionInstructorSyncInputs> {
    return this.transaction(async (session) => {
      // Node 드라이버는 한 트랜잭션 내 병렬 작업을 지원하지 않으므로 순차 scan.
      const operations = await this.store.scan("OperationSession", { deletedAt: null }, session);
      const courses = await this.store.scan("Course", {}, session);
      const engagements = await this.store.scan("InstructorEngagement", { operationSessionId: { $ne: null } }, session);
      const instructorNotes = await this.store.scan("InstructorNote", {}, session);

      // Prisma의 course relation은 Mongo에 없으므로 courseRecordId→Course.id 수동 조인으로 과정명을 푼다.
      const courseById = new Map(courses.map((row) => [row.id as string, row]));
      const sessions: SyncInstructorSessionInput[] = operations.map((row) => ({
        operationSessionId: row.id as string,
        courseName: (courseById.get(row.courseRecordId as string)?.name as string) ?? "",
        instructorsText: row.instructorsText as string | null,
        startDate: row.startDate as Date,
        endDate: row.endDate as Date,
        scheduleDates: (row.educationDates as Date[]) ?? [],
        startTime: null, // 회차 timeText 파싱은 신뢰도가 낮아 기본값(09:00~18:00)을 쓴다.
        endTime: null
      }));

      const existingBySession = new Map<string, ExistingSessionInstructorEngagement[]>();
      for (const row of engagements) {
        const sid = row.operationSessionId as string | null;
        if (!sid) continue;
        const list = existingBySession.get(sid) ?? [];
        list.push({ id: row.id as string, instructorNoteId: row.instructorNoteId as string, source: row.source as "CONTRACT" | "MANUAL", status: row.status as string });
        existingBySession.set(sid, list);
      }

      const instructors = instructorNotes.map((row) => ({ id: row.id as string, name: ((row.displayName as string | null) ?? (row.instructorName as string)) }));
      return { sessions, existingBySession, instructors };
    }, READ_TIMEOUT_MS);
  }

  async withWriter<T>(run: (writer: SessionInstructorWriter) => Promise<T>): Promise<T> {
    // 생성/전환/취소가 ActivityChange 감사행을 쓰므로 activity 컨텍스트가 필수(Mongo 런타임이 합성 액터로 세운다).
    assertMongo(activityContext.getStore(), "ACTIVITY_CONTEXT_REQUIRED");
    return this.transaction(async (session) => {
      await lockMongoInstructorCatalog(this.store, session);
      return run(this.writer(session));
    }, TXN_TIMEOUT_MS);
  }

  async setSessionInstructors(operationSessionId: string, instructorNoteIds: ReadonlyArray<string>, today: Date): Promise<ApplySessionInstructorsResult> {
    assertMongo(activityContext.getStore(), "ACTIVITY_CONTEXT_REQUIRED");
    return this.transaction(async (session) => {
      await lockMongoInstructorCatalog(this.store, session);
      // 읽기+적용을 한 트랜잭션에서: 그 회차·기존 투입을 읽어 선택 집합으로 맞춘다.
      const operation = await this.store.one("OperationSession", { _id: operationSessionId, deletedAt: null }, session);
      assertMongo(operation, "SESSION_INSTRUCTOR_SYNC_SESSION_MISSING");
      const course = operation.courseRecordId ? await this.store.one("Course", { _id: operation.courseRecordId as string }, session) : null;
      const engagementRows = await this.store.scan("InstructorEngagement", { operationSessionId }, session);
      const existing: ExistingSessionInstructorEngagement[] = engagementRows.map((row) => ({
        id: row.id as string,
        instructorNoteId: row.instructorNoteId as string,
        source: row.source as "CONTRACT" | "MANUAL",
        status: row.status as string
      }));
      return applySessionInstructorsByIds(
        {
          operationSessionId,
          courseName: (course?.name as string) ?? "",
          instructorNoteIds,
          startDate: operation.startDate as Date,
          endDate: operation.endDate as Date,
          scheduleDates: (operation.educationDates as Date[]) ?? [],
          startTime: null,
          endTime: null
        },
        existing,
        this.writer(session),
        today
      );
    }, TXN_TIMEOUT_MS);
  }

  private async transaction<T>(work: (session: ClientSession) => Promise<T>, timeoutMs: number): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(() => work(session), {
          readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: timeoutMs
        });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoOperationError) throw error;
        throw new MongoOperationError("SESSION_INSTRUCTOR_SYNC_TRANSACTION_FAILED");
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("SESSION_INSTRUCTOR_SYNC_RETRY_LIMIT");
  }
}
