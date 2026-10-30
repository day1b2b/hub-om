import { getPrismaClient } from "./prisma";
import type { SessionSurveyResultRepository } from "./sessionSurveyResultRepository";
import {
  commentLines,
  commentStatusFromRecord,
  commentStatusToRecord,
  type SessionSurveyResult,
  type SessionSurveyResultInput
} from "./sessionSurveyResultTypes";

interface Row {
  operationId: string;
  recordId: string | null;
  overall: string | null;
  instructorSatisfaction: string | null;
  respondents: number | null;
  positiveRate: string | null;
  commentStatus: string | null;
  commentPositive: unknown;
  commentImprove: unknown;
  appliedBy: string | null;
  appliedAt: Date;
}

function toResult(row: Row): SessionSurveyResult {
  const status = commentStatusFromRecord(row.commentStatus);
  return {
    operationId: row.operationId,
    recordId: row.recordId,
    overall: row.overall,
    instructorSatisfaction: row.instructorSatisfaction,
    respondents: row.respondents,
    positiveRate: row.positiveRate,
    comments: status ? { status, positive: commentLines(row.commentPositive), improve: commentLines(row.commentImprove) } : null,
    appliedBy: row.appliedBy,
    appliedAt: row.appliedAt.toISOString()
  };
}

export class PrismaSessionSurveyResultRepository implements SessionSurveyResultRepository {
  async listByOperationIds(operationIds: readonly string[]): Promise<SessionSurveyResult[]> {
    if (operationIds.length === 0) return [];
    const rows = await getPrismaClient().sessionSurveyResult.findMany({ where: { operationId: { in: [...operationIds] } } });
    return rows.map((row) => toResult(row as Row));
  }

  async upsert(input: SessionSurveyResultInput): Promise<SessionSurveyResult> {
    const measured = {
      recordId: input.recordId,
      overall: input.overall,
      instructorSatisfaction: input.instructorSatisfaction,
      respondents: input.respondents,
      positiveRate: input.positiveRate,
      appliedBy: input.appliedBy,
      appliedAt: new Date()
    };
    // 코멘트가 안 온 요청(구버전 앱)은 코멘트 칸을 건드리지 않는다.
    const comments = input.comments
      ? {
          commentStatus: commentStatusToRecord(input.comments.status),
          commentPositive: input.comments.positive,
          commentImprove: input.comments.improve
        }
      : {};
    const row = await getPrismaClient().sessionSurveyResult.upsert({
      where: { operationId: input.operationId },
      create: { operationId: input.operationId, ...measured, ...comments },
      update: { ...measured, ...comments }
    });
    return toResult(row as Row);
  }
}
