import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import type { CoachEvaluationScores, CoachFactRecordInput, CoachOmEvaluationInput } from "@/lib/coaches/coachEvaluationRules";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady } from "./mongoReadStore";
import { assertMongoCoachSchedulingGuardReady, lockMongoCoachScheduling } from "./mongoCoachSchedulingGuard";
import {
  CoachEvaluationError,
  type CoachEngagementDetailRecord,
  type CoachEvaluationActor,
  type CoachEvaluationEngagementRef,
  type CoachFactRecordView,
  type CoachEvaluationRecord,
  type CoachEvaluationRepository
} from "./coachEvaluationRepository";

/** 평가 저장소가 여는 컬렉션. OperationSession은 담당 OM 확인용으로 읽기만 한다. */
export const COACH_EVALUATION_REPOSITORY_MODELS = ["Coach", "CoachEngagement", "CoachEngagementDetail", "CoachEvaluation", "CoachFactRecord", "OperationSession"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };

const dateKey = (value: unknown) => (value as Date).toISOString().slice(0, 10);
const scoresOf = (row: MongoRow): CoachEvaluationScores => ({
  practiceSupport: row.practiceSupport as number | null,
  fieldOperation: row.fieldOperation as number | null,
  communication: row.communication as number | null,
  leading: row.leading as number | null,
  punctuality: row.punctuality as number | null
});
const record = (row: MongoRow): CoachEvaluationRecord => ({
  id: row.id as string, coachId: row.coachId as string, engagementId: row.engagementId as string | null, source: "OM",
  courseName: row.courseName as string, startDate: dateKey(row.startDate), endDate: dateKey(row.endDate), scores: scoresOf(row),
  rehire: row.rehire as CoachEvaluationRecord["rehire"], rehireReason: row.rehireReason as string | null, evidence: row.evidence as string | null,
  evaluatorEmail: row.evaluatorEmail as string, evaluatorName: row.evaluatorName as string | null,
  createdAt: row.createdAt as Date, updatedAt: row.updatedAt as Date
});
const detail = (row: MongoRow): CoachEngagementDetailRecord => ({
  engagementId: row.engagementId as string, role: row.role as CoachEngagementDetailRecord["role"],
  practiceDifficulty: row.practiceDifficulty as CoachEngagementDetailRecord["practiceDifficulty"],
  audience: row.audience as CoachEngagementDetailRecord["audience"], isNewClient: row.isNewClient as boolean | null,
  updatedAt: row.updatedAt as Date
});
const fact = (row: MongoRow): CoachFactRecordView => ({
  id: row.id as string, coachId: row.coachId as string, engagementId: row.engagementId as string | null, kind: row.kind as CoachFactRecordView["kind"],
  occurredOn: dateKey(row.occurredOn), courseName: row.courseName as string | null, description: row.description as string,
  recordedByEmail: row.recordedByEmail as string, recordedByName: row.recordedByName as string | null, createdAt: row.createdAt as Date
});
const evaluationFields = (input: CoachOmEvaluationInput) => ({ ...input.scores, rehire: input.rehire, rehireReason: input.rehireReason, evidence: input.evidence });

/** Opens prepared storage only. Collections come from scripts/prepare-mongodb-coach-evaluation-collections.ts. */
export class MongoCoachEvaluationRepository implements CoachEvaluationRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_EVALUATION_REPOSITORY_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      return new MongoCoachEvaluationRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_EVALUATION_OPEN_FAILED"); }
  }
  private async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); }
    catch (error) { if (error instanceof MongoOperationError || error instanceof CoachEvaluationError) throw error; throw new MongoOperationError("COACH_EVALUATION_READ_FAILED"); }
    finally { await session.endSession(); }
  }
  private async write<T>(coachId: string, work: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          // 같은 코치의 쓰기를 한 줄로 세워 "투입당 OM 평가 1개"를 지킨다(코치 메모와 같은 잠금).
          await lockMongoCoachScheduling(this.store, coachId, session);
          if (!await this.store.one("Coach", { _id: coachId }, session)) throw new CoachEvaluationError("ENGAGEMENT_NOT_FOUND");
          return work(session);
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 60_000 });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoOperationError || error instanceof CoachEvaluationError) throw error;
        throw new MongoOperationError("COACH_EVALUATION_WRITE_FAILED");
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_EVALUATION_RETRY_LIMIT");
  }
  private async upsertDetail(coachId: string, engagementId: string, input: CoachOmEvaluationInput, actor: CoachEvaluationActor, session: ClientSession) {
    const now = new Date();
    const before = await this.store.one("CoachEngagementDetail", { engagementId }, session);
    const fields = { ...input.detail, updatedBy: actor.email, updatedAt: now };
    const row = completeMongoRow("CoachEngagementDetail", before ? { ...before, ...fields } : { id: randomUUID(), engagementId, coachId, createdAt: now, ...fields });
    const collection = this.store.collection("CoachEngagementDetail");
    if (before) assertMongo((await collection.replaceOne({ _id: before.id as string }, encodeMongoRuntimeDocument("CoachEngagementDetail", row), { session })).matchedCount === 1, "COACH_EVALUATION_WRITE_FAILED");
    else await collection.insertOne(encodeMongoRuntimeDocument("CoachEngagementDetail", row), { session });
  }

  /** 투입마다 연결된 운영현황 회차의 담당 OM을 붙인다(지워진 회차는 연결 없음으로 본다). */
  private async engagementRefs(rows: MongoRow[], session: ClientSession): Promise<CoachEvaluationEngagementRef[]> {
    const ids = [...new Set(rows.map(row => row.operationSessionId).filter((id): id is string => typeof id === "string"))];
    const sessions = new Map(ids.length ? (await this.store.scan("OperationSession", { _id: { $in: ids }, deletedAt: null }, session)).map(row => [row.id as string, row]) : []);
    return rows.map(row => {
      const linked = typeof row.operationSessionId === "string" ? sessions.get(row.operationSessionId) : undefined;
      return {
        id: row.id as string, coachId: row.coachId as string, courseName: row.courseName as string, startDate: dateKey(row.startDate), endDate: dateKey(row.endDate),
        operationManagers: [linked?.omName, linked?.onsiteOmName].filter((name): name is string => typeof name === "string" && !!name.trim()),
        contractRequester: row.hiredByText as string | null
      };
    });
  }
  async getEngagement(input: string, engagementId: string) {
    const coachId = input.toLowerCase();
    return this.read(async session => {
      const row = await this.store.one("CoachEngagement", { _id: engagementId.toLowerCase(), coachId }, session);
      return row ? (await this.engagementRefs([row], session))[0] : null;
    });
  }
  async listForCoach(input: string) {
    const coachId = input.toLowerCase();
    return this.read(async session => {
      const evaluations = (await this.store.scan("CoachEvaluation", { coachId, source: "OM", deletedAt: null }, session)).map(record)
        .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.createdAt.getTime() - a.createdAt.getTime());
      const details = (await this.store.scan("CoachEngagementDetail", { coachId }, session)).map(detail);
      const engagements = await this.engagementRefs(await this.store.scan("CoachEngagement", { coachId }, session), session);
      const facts = (await this.store.scan("CoachFactRecord", { coachId, deletedAt: null }, session)).map(fact)
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.getTime() - a.createdAt.getTime());
      return { evaluations, details, engagements, facts };
    });
  }
  async getEvaluation(input: string, evaluationId: string) {
    const coachId = input.toLowerCase();
    return this.read(async session => {
      const row = await this.store.one("CoachEvaluation", { _id: evaluationId.toLowerCase(), coachId, source: "OM", deletedAt: null }, session);
      return row ? record(row) : null;
    });
  }
  async createOmEvaluation(input: string, engagementInput: string, values: CoachOmEvaluationInput, actor: CoachEvaluationActor) {
    const coachId = input.toLowerCase(), engagementId = engagementInput.toLowerCase();
    return this.write(coachId, async session => {
      const engagement = await this.store.one("CoachEngagement", { _id: engagementId, coachId }, session);
      if (!engagement) throw new CoachEvaluationError("ENGAGEMENT_NOT_FOUND");
      if (await this.store.one("CoachEvaluation", { engagementId, source: "OM", deletedAt: null }, session)) throw new CoachEvaluationError("ALREADY_EVALUATED");
      await this.upsertDetail(coachId, engagementId, values, actor, session);
      const now = new Date();
      const row = completeMongoRow("CoachEvaluation", {
        id: randomUUID(), coachId, engagementId, source: "OM", courseName: engagement.courseName, startDate: engagement.startDate, endDate: engagement.endDate,
        ...evaluationFields(values), evaluatorEmail: actor.email, evaluatorName: actor.name, createdAt: now, updatedAt: now
      });
      await this.store.collection("CoachEvaluation").insertOne(encodeMongoRuntimeDocument("CoachEvaluation", row), { session });
      return record(row);
    });
  }
  async updateOmEvaluation(input: string, evaluationId: string, values: CoachOmEvaluationInput, actor: CoachEvaluationActor) {
    const coachId = input.toLowerCase();
    return this.write(coachId, async session => {
      const before = await this.store.one("CoachEvaluation", { _id: evaluationId.toLowerCase(), coachId, source: "OM", deletedAt: null }, session);
      if (!before) throw new CoachEvaluationError("EVALUATION_NOT_FOUND");
      // 투입이 지워진 평가(engagementId=null)는 점수만 고친다.
      if (before.engagementId) await this.upsertDetail(coachId, before.engagementId as string, values, actor, session);
      const row = completeMongoRow("CoachEvaluation", { ...before, ...evaluationFields(values), updatedAt: new Date() });
      const result = await this.store.collection("CoachEvaluation").replaceOne({ _id: row.id as string, coachId }, encodeMongoRuntimeDocument("CoachEvaluation", row), { session });
      assertMongo(result.matchedCount === 1, "COACH_EVALUATION_WRITE_FAILED");
      return record(row);
    });
  }
  async deleteEvaluation(input: string, evaluationId: string, actor: CoachEvaluationActor) {
    const coachId = input.toLowerCase();
    await this.write(coachId, async session => {
      const before = await this.store.one("CoachEvaluation", { _id: evaluationId.toLowerCase(), coachId, source: "OM", deletedAt: null }, session);
      if (!before) throw new CoachEvaluationError("EVALUATION_NOT_FOUND");
      const now = new Date();
      const row = completeMongoRow("CoachEvaluation", { ...before, deletedAt: now, deletedBy: actor.email, updatedAt: now });
      const result = await this.store.collection("CoachEvaluation").replaceOne({ _id: row.id as string, coachId }, encodeMongoRuntimeDocument("CoachEvaluation", row), { session });
      assertMongo(result.matchedCount === 1, "COACH_EVALUATION_WRITE_FAILED");
    });
  }
  async getFactRecord(input: string, factId: string) {
    const coachId = input.toLowerCase();
    return this.read(async session => {
      const row = await this.store.one("CoachFactRecord", { _id: factId.toLowerCase(), coachId, deletedAt: null }, session);
      return row ? fact(row) : null;
    });
  }
  async createFactRecord(input: string, engagementInput: string, values: CoachFactRecordInput, actor: CoachEvaluationActor) {
    const coachId = input.toLowerCase(), engagementId = engagementInput.toLowerCase();
    return this.write(coachId, async session => {
      const engagement = await this.store.one("CoachEngagement", { _id: engagementId, coachId }, session);
      if (!engagement) throw new CoachEvaluationError("ENGAGEMENT_NOT_FOUND");
      const now = new Date();
      const row = completeMongoRow("CoachFactRecord", {
        id: randomUUID(), coachId, engagementId, kind: values.kind, occurredOn: new Date(`${values.occurredOn}T00:00:00.000Z`),
        courseName: engagement.courseName, description: values.description, recordedByEmail: actor.email, recordedByName: actor.name, createdAt: now, updatedAt: now
      });
      await this.store.collection("CoachFactRecord").insertOne(encodeMongoRuntimeDocument("CoachFactRecord", row), { session });
      return fact(row);
    });
  }
  async deleteFactRecord(input: string, factId: string, actor: CoachEvaluationActor) {
    const coachId = input.toLowerCase();
    await this.write(coachId, async session => {
      const before = await this.store.one("CoachFactRecord", { _id: factId.toLowerCase(), coachId, deletedAt: null }, session);
      if (!before) throw new CoachEvaluationError("FACT_NOT_FOUND");
      const now = new Date();
      const row = completeMongoRow("CoachFactRecord", { ...before, deletedAt: now, deletedBy: actor.email, updatedAt: now });
      const result = await this.store.collection("CoachFactRecord").replaceOne({ _id: row.id as string, coachId }, encodeMongoRuntimeDocument("CoachFactRecord", row), { session });
      assertMongo(result.matchedCount === 1, "COACH_EVALUATION_WRITE_FAILED");
    });
  }
  async listOmAverageInputs() {
    return this.read(async session => (await this.store.scan("CoachEvaluation", { source: "OM", deletedAt: null }, session))
      .map(row => ({ coachId: row.coachId as string, engagementId: row.engagementId as string | null, scores: scoresOf(row) })));
  }
}
