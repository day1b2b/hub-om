import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, MONGO_SCAN_ROWS, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import type { SessionSurveyResultRepository } from "./sessionSurveyResultRepository";
import {
  commentLines,
  commentStatusFromRecord,
  commentStatusToRecord,
  type SessionSurveyResult,
  type SessionSurveyResultInput
} from "./sessionSurveyResultTypes";

// SessionSurveyResult는 OPERATION_MODELS 밖의 추가 전용 컬렉션이다. 운영 Mongo에는 배포 전에
// scripts/apply-mongodb-session-survey-result-collection.ts로 먼저 만들어 둔다
// (docs/operations/mongodb-session-survey-result-collection.md).
export const SESSION_SURVEY_RESULT_MODELS = ["SessionSurveyResult", "ActivityChange"] as const;
export type MongoSessionSurveyResultOptions = MongoOperationOptions & { allowShadowWrites?: true };

function toResult(row: MongoRow): SessionSurveyResult {
  const status = commentStatusFromRecord(row.commentStatus);
  return {
    operationId: row.operationId as string,
    recordId: (row.recordId as string | null) ?? null,
    overall: (row.overall as string | null) ?? null,
    instructorSatisfaction: (row.instructorSatisfaction as string | null) ?? null,
    respondents: (row.respondents as number | null) ?? null,
    positiveRate: (row.positiveRate as string | null) ?? null,
    comments: status ? { status, positive: commentLines(row.commentPositive), improve: commentLines(row.commentImprove) } : null,
    appliedBy: (row.appliedBy as string | null) ?? null,
    appliedAt: (row.appliedAt as Date).toISOString()
  };
}

export class MongoSessionSurveyResultRepository implements SessionSurveyResultRepository {
  private readonly store: MongoOperationStore;
  private readonly allowWrites: boolean;
  private constructor(store: MongoOperationStore, allowWrites: boolean) { this.store = store; this.allowWrites = allowWrites; }

  static async open(options: MongoSessionSurveyResultOptions): Promise<MongoSessionSurveyResultRepository> {
    try {
      const store = new MongoOperationStore(options, SESSION_SURVEY_RESULT_MODELS);
      await assertMongoReadStoreReady(store);
      return new MongoSessionSurveyResultRepository(store, options.allowShadowWrites === true);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("SESSION_SURVEY_RESULT_OPEN_FAILED");
    }
  }

  async listByOperationIds(operationIds: readonly string[]): Promise<SessionSurveyResult[]> {
    const ids = [...new Set(operationIds)];
    assertMongo(ids.length <= MONGO_SCAN_ROWS && ids.every((id) => typeof id === "string" && id.length > 0), "SESSION_SURVEY_RESULT_INVALID_ID");
    if (ids.length === 0) return [];
    const rows = await this.store.scan("SessionSurveyResult", { operationId: { $in: ids } });
    return rows.map(toResult);
  }

  async upsert(input: SessionSurveyResultInput): Promise<SessionSurveyResult> {
    assertMongo(this.allowWrites, "SHADOW_WRITE_GATE");
    assertMongo(typeof input.operationId === "string" && input.operationId.length > 0, "SESSION_SURVEY_RESULT_INVALID_ID");
    const session = this.store.client.startSession();
    try {
      return await session.withTransaction(
        () => this.applyUpsert(input, session),
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 }
      );
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("SESSION_SURVEY_RESULT_TRANSACTION_FAILED");
    } finally {
      await session.endSession();
    }
  }

  private async applyUpsert(input: SessionSurveyResultInput, session: ClientSession): Promise<SessionSurveyResult> {
    const previous = await this.store.one("SessionSurveyResult", { operationId: input.operationId }, session);
    const now = new Date();
    // 코멘트가 안 온 요청(구버전 앱)은 저장된 코멘트를 그대로 둔다.
    const comments = input.comments
      ? { commentStatus: commentStatusToRecord(input.comments.status), commentPositive: input.comments.positive, commentImprove: input.comments.improve }
      : previous
        ? { commentStatus: previous.commentStatus, commentPositive: previous.commentPositive, commentImprove: previous.commentImprove }
        : {};
    const next = completeMongoRow("SessionSurveyResult", {
      id: (previous?.id as string | undefined) ?? randomUUID(),
      operationId: input.operationId,
      recordId: input.recordId,
      overall: input.overall,
      instructorSatisfaction: input.instructorSatisfaction,
      respondents: input.respondents,
      positiveRate: input.positiveRate,
      ...comments,
      appliedBy: input.appliedBy,
      appliedAt: now,
      createdAt: (previous?.createdAt as Date | undefined) ?? now
    });
    const document = encodeMongoRuntimeDocument("SessionSurveyResult", next);
    if (previous) {
      const result = await this.store.collection("SessionSurveyResult").replaceOne({ _id: previous.id as string }, document, { session });
      assertMongo(result.matchedCount === 1, "SESSION_SURVEY_RESULT_DISAPPEARED");
    } else {
      await this.store.collection("SessionSurveyResult").insertOne(document, { session });
    }
    const audit = operationAuditRow("SessionSurveyResult", previous, next);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
    return toResult(next);
  }
}
