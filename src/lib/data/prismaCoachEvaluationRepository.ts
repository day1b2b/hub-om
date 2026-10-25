import type { Prisma } from "@prisma/client";
import type { CoachEvaluationScores, CoachOmEvaluationInput } from "@/lib/coaches/coachEvaluationRules";
import { getPrismaClient } from "./prisma";
import {
  CoachEvaluationError,
  type CoachEngagementDetailRecord,
  type CoachEvaluationActor,
  type CoachEvaluationEngagementRef,
  type CoachEvaluationRecord,
  type CoachEvaluationRepository
} from "./coachEvaluationRepository";

type EvaluationRow = Prisma.CoachEvaluationGetPayload<Record<string, never>>;
type DetailRow = Prisma.CoachEngagementDetailGetPayload<Record<string, never>>;

const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const scoresOf = (row: EvaluationRow): CoachEvaluationScores => ({
  practiceSupport: row.practiceSupport,
  fieldOperation: row.fieldOperation,
  communication: row.communication,
  leading: row.leading,
  punctuality: row.punctuality
});

function toRecord(row: EvaluationRow): CoachEvaluationRecord {
  return {
    id: row.id,
    coachId: row.coachId,
    engagementId: row.engagementId,
    source: "OM",
    courseName: row.courseName,
    startDate: dateKey(row.startDate),
    endDate: dateKey(row.endDate),
    scores: scoresOf(row),
    rehire: row.rehire,
    rehireReason: row.rehireReason,
    evidence: row.evidence,
    evaluatorEmail: row.evaluatorEmail,
    evaluatorName: row.evaluatorName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toDetail(row: DetailRow): CoachEngagementDetailRecord {
  return {
    engagementId: row.engagementId,
    role: row.role,
    practiceDifficulty: row.practiceDifficulty,
    audience: row.audience,
    isNewClient: row.isNewClient,
    updatedAt: row.updatedAt
  };
}

function evaluationFields(input: CoachOmEvaluationInput) {
  return { ...input.scores, rehire: input.rehire, rehireReason: input.rehireReason, evidence: input.evidence };
}

async function upsertDetail(tx: Prisma.TransactionClient, coachId: string, engagementId: string, input: CoachOmEvaluationInput, actor: CoachEvaluationActor) {
  const data = { ...input.detail, updatedBy: actor.email };
  await tx.coachEngagementDetail.upsert({ where: { engagementId }, create: { engagementId, coachId, ...data }, update: data });
}

/** 같은 코치의 평가 쓰기를 한 줄로 세워 "투입당 OM 평가 1개"를 지킨다. */
async function lockCoach(tx: Prisma.TransactionClient, coachId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM coaches WHERE id = ${coachId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new CoachEvaluationError("ENGAGEMENT_NOT_FOUND");
}

const engagementSelect = {
  id: true, coachId: true, courseName: true, startDate: true, endDate: true, hiredByText: true,
  operationSession: { select: { omName: true, onsiteOmName: true, deletedAt: true } }
} as const;
type EngagementRow = Prisma.CoachEngagementGetPayload<{ select: typeof engagementSelect }>;

function toEngagementRef(row: EngagementRow): CoachEvaluationEngagementRef {
  const session = row.operationSession && !row.operationSession.deletedAt ? row.operationSession : null;
  return {
    id: row.id,
    coachId: row.coachId,
    courseName: row.courseName,
    startDate: dateKey(row.startDate),
    endDate: dateKey(row.endDate),
    operationManagers: [session?.omName, session?.onsiteOmName].filter((name): name is string => !!name?.trim()),
    contractRequester: row.hiredByText
  };
}

/** Default PostgreSQL backend. */
export class PrismaCoachEvaluationRepository implements CoachEvaluationRepository {
  async getEngagement(coachId: string, engagementId: string) {
    const row = await getPrismaClient().coachEngagement.findFirst({ where: { id: engagementId, coachId }, select: engagementSelect });
    return row ? toEngagementRef(row) : null;
  }

  async listForCoach(coachId: string) {
    const prisma = getPrismaClient();
    const [evaluations, details, engagements] = await Promise.all([
      prisma.coachEvaluation.findMany({ where: { coachId, source: "OM", deletedAt: null }, orderBy: [{ endDate: "desc" }, { createdAt: "desc" }] }),
      prisma.coachEngagementDetail.findMany({ where: { coachId } }),
      prisma.coachEngagement.findMany({ where: { coachId }, select: engagementSelect })
    ]);
    return { evaluations: evaluations.map(toRecord), details: details.map(toDetail), engagements: engagements.map(toEngagementRef) };
  }

  async getEvaluation(coachId: string, evaluationId: string) {
    const row = await getPrismaClient().coachEvaluation.findFirst({ where: { id: evaluationId, coachId, source: "OM", deletedAt: null } });
    return row ? toRecord(row) : null;
  }

  async createOmEvaluation(coachId: string, engagementId: string, input: CoachOmEvaluationInput, actor: CoachEvaluationActor) {
    return getPrismaClient().$transaction(async (tx) => {
      await lockCoach(tx, coachId);
      const engagement = await tx.coachEngagement.findFirst({ where: { id: engagementId, coachId } });
      if (!engagement) throw new CoachEvaluationError("ENGAGEMENT_NOT_FOUND");
      const existing = await tx.coachEvaluation.count({ where: { engagementId, source: "OM", deletedAt: null } });
      if (existing > 0) throw new CoachEvaluationError("ALREADY_EVALUATED");
      await upsertDetail(tx, coachId, engagementId, input, actor);
      const row = await tx.coachEvaluation.create({
        data: {
          coachId,
          engagementId,
          source: "OM",
          courseName: engagement.courseName,
          startDate: engagement.startDate,
          endDate: engagement.endDate,
          ...evaluationFields(input),
          evaluatorEmail: actor.email,
          evaluatorName: actor.name
        }
      });
      return toRecord(row);
    });
  }

  async updateOmEvaluation(coachId: string, evaluationId: string, input: CoachOmEvaluationInput, actor: CoachEvaluationActor) {
    return getPrismaClient().$transaction(async (tx) => {
      await lockCoach(tx, coachId);
      const before = await tx.coachEvaluation.findFirst({ where: { id: evaluationId, coachId, source: "OM", deletedAt: null } });
      if (!before) throw new CoachEvaluationError("EVALUATION_NOT_FOUND");
      // 투입이 지워진 평가(engagementId=null)는 점수만 고친다.
      if (before.engagementId) await upsertDetail(tx, coachId, before.engagementId, input, actor);
      const row = await tx.coachEvaluation.update({ where: { id: evaluationId }, data: evaluationFields(input) });
      return toRecord(row);
    });
  }

  async deleteEvaluation(coachId: string, evaluationId: string, actor: CoachEvaluationActor) {
    const result = await getPrismaClient().coachEvaluation.updateMany({
      where: { id: evaluationId, coachId, source: "OM", deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: actor.email }
    });
    if (result.count !== 1) throw new CoachEvaluationError("EVALUATION_NOT_FOUND");
  }

  async listOmAverageInputs() {
    const rows = await getPrismaClient().coachEvaluation.findMany({ where: { source: "OM", deletedAt: null } });
    return rows.map((row) => ({ coachId: row.coachId, engagementId: row.engagementId, scores: scoresOf(row) }));
  }
}
