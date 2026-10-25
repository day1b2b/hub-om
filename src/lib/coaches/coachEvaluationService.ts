import { NextResponse } from "next/server";
import { findTeamUsersByEmail } from "@/lib/data/teamUsers/teamUserRepository";
import { getCoachEvaluationRepository } from "@/lib/data/coachEvaluationRepositoryFactory";
import {
  CoachEvaluationError,
  type CoachEvaluationActor,
  type CoachEvaluationEngagementRef,
  type CoachEvaluationRecord,
  type CoachFactRecordView
} from "@/lib/data/coachEvaluationRepository";
import { normalizePersonName } from "@/lib/data/myOperations";
import { splitPersonNames } from "@/lib/data/personNames";
import { seoulTodayKey } from "./coachActivity";
import {
  canEditCoachEvaluation,
  canViewCoachEvaluations,
  coachPolicyOwnerEmails,
  isEngagementEvaluable,
  validateFactRecordInput,
  validateOmEvaluationInput,
  type CoachEvaluationViewer
} from "./coachEvaluationRules";

// =============================================================================
// 코치 OM 평가 API 처리. 라우트는 세션만 넘기고, 권한·검증·응답 모양은 여기서 정한다.
// 평가 원문은 OM·LD·정책 담당자만 본다. 권한이 없으면 내용 없이 canView=false만 준다.
// 평가·사실 기록 쓰기는 그 과정의 담당 매니저(운영현황 담당 OM·현장 OM)와 정책 담당자만 한다.
// =============================================================================

export interface CoachEvaluationSessionUser {
  email: string;
  name: string | null;
}

export async function resolveCoachEvaluationViewer(user: CoachEvaluationSessionUser): Promise<CoachEvaluationViewer> {
  const email = user.email.trim().toLowerCase();
  // 명단 조회가 실패하면 권한을 추정하지 않고 닫는다.
  const members = await findTeamUsersByEmail(email).catch(() => []);
  const roles = [...new Set(members.map((member) => member.role).filter((role): role is "om" | "ld" => role === "om" || role === "ld"))];
  return { email, names: members.map((member) => member.name), roles, isPolicyOwner: coachPolicyOwnerEmails().includes(email) };
}

/**
 * 투입의 담당 매니저인지. 운영현황 회차와 연결돼 있으면 그 회차의 담당 OM·현장 OM으로,
 * 연결이 없으면 계약 요청자로 본다. 둘 다 없으면 아무도 담당이 아니다(정책 담당자만 쓴다).
 */
export function isEngagementManager(viewer: CoachEvaluationViewer, engagement: Pick<CoachEvaluationEngagementRef, "operationManagers" | "contractRequester">): boolean {
  const sources = engagement.operationManagers.length > 0 ? engagement.operationManagers : [engagement.contractRequester];
  const managers = new Set(sources.flatMap((value) => splitPersonNames(value, "")).map(normalizePersonName).filter(Boolean));
  return viewer.names.some((name) => managers.has(normalizePersonName(name)));
}

function canWriteFor(viewer: CoachEvaluationViewer, engagement: CoachEvaluationEngagementRef): boolean {
  return viewer.isPolicyOwner || (canViewCoachEvaluations(viewer) && isEngagementManager(viewer, engagement));
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const denied = () => json({ ok: false, error: "코치 평가는 OM·LD만 볼 수 있어요." }, 403);

function errorResponse(error: unknown) {
  if (error instanceof CoachEvaluationError) {
    if (error.code === "ALREADY_EVALUATED") return json({ ok: false, error: "이 투입은 이미 평가했어요. 새로고침 후 기존 평가를 고쳐 주세요." }, 409);
    if (error.code === "ENGAGEMENT_NOT_FOUND") return json({ ok: false, error: "투입 이력을 찾을 수 없어요." }, 404);
    if (error.code === "FACT_NOT_FOUND") return json({ ok: false, error: "사실 기록을 찾을 수 없어요." }, 404);
    return json({ ok: false, error: "평가를 찾을 수 없어요." }, 404);
  }
  throw error;
}

function present(evaluation: CoachEvaluationRecord, viewer: CoachEvaluationViewer) {
  return { ...evaluation, canEdit: canEditCoachEvaluation(viewer, evaluation.evaluatorEmail) };
}

function presentFact(fact: CoachFactRecordView, viewer: CoachEvaluationViewer) {
  return { ...fact, canDelete: canEditCoachEvaluation(viewer, fact.recordedByEmail) };
}

function actorOf(user: CoachEvaluationSessionUser): CoachEvaluationActor {
  return { email: user.email.trim().toLowerCase(), name: user.name };
}

export async function listCoachEvaluationsResponse(coachId: string, user: CoachEvaluationSessionUser) {
  const viewer = await resolveCoachEvaluationViewer(user);
  if (!canViewCoachEvaluations(viewer)) return json({ ok: true, canView: false, evaluations: [], details: [], facts: [], writableEngagementIds: [] });
  const { evaluations, details, engagements, facts } = await getCoachEvaluationRepository().listForCoach(coachId);
  return json({
    ok: true,
    canView: true,
    today: seoulTodayKey(),
    evaluations: evaluations.map((item) => present(item, viewer)),
    details,
    facts: facts.map((fact) => presentFact(fact, viewer)),
    // 담당 매니저 이름은 내려주지 않고, 이 사람이 평가를 쓸 수 있는 투입 ID만 준다.
    writableEngagementIds: engagements.filter((engagement) => canWriteFor(viewer, engagement)).map((engagement) => engagement.id)
  });
}

export async function createCoachEvaluationResponse(coachId: string, body: unknown, user: CoachEvaluationSessionUser) {
  const viewer = await resolveCoachEvaluationViewer(user);
  if (!canViewCoachEvaluations(viewer)) return denied();
  const engagementId = typeof (body as { engagementId?: unknown } | null)?.engagementId === "string" ? (body as { engagementId: string }).engagementId : "";
  if (!engagementId) return json({ ok: false, error: "평가할 투입을 골라 주세요." }, 400);
  const validation = validateOmEvaluationInput(body);
  if (!validation.ok) return json({ ok: false, error: validation.error }, 400);

  const repository = getCoachEvaluationRepository();
  const engagement = await repository.getEngagement(coachId, engagementId);
  if (!engagement) return json({ ok: false, error: "투입 이력을 찾을 수 없어요." }, 404);
  if (!canWriteFor(viewer, engagement)) return json({ ok: false, error: "이 과정의 담당 매니저만 평가할 수 있어요." }, 403);
  if (!isEngagementEvaluable(engagement.endDate, seoulTodayKey())) return json({ ok: false, error: "과정이 끝난 뒤에 평가할 수 있어요." }, 400);
  try {
    const evaluation = await repository.createOmEvaluation(coachId, engagementId, validation.value, actorOf(user));
    return json({ ok: true, evaluation: present(evaluation, viewer) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function updateCoachEvaluationResponse(coachId: string, evaluationId: string, body: unknown, user: CoachEvaluationSessionUser) {
  const viewer = await resolveCoachEvaluationViewer(user);
  if (!canViewCoachEvaluations(viewer)) return denied();
  const repository = getCoachEvaluationRepository();
  const existing = await repository.getEvaluation(coachId, evaluationId);
  if (!existing) return json({ ok: false, error: "평가를 찾을 수 없어요." }, 404);
  if (!canEditCoachEvaluation(viewer, existing.evaluatorEmail)) return json({ ok: false, error: "평가를 쓴 사람과 정책 담당자만 고칠 수 있어요." }, 403);
  const validation = validateOmEvaluationInput(body);
  if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
  try {
    const evaluation = await repository.updateOmEvaluation(coachId, evaluationId, validation.value, actorOf(user));
    return json({ ok: true, evaluation: present(evaluation, viewer) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function deleteCoachEvaluationResponse(coachId: string, evaluationId: string, user: CoachEvaluationSessionUser) {
  const viewer = await resolveCoachEvaluationViewer(user);
  if (!canViewCoachEvaluations(viewer)) return denied();
  const repository = getCoachEvaluationRepository();
  const existing = await repository.getEvaluation(coachId, evaluationId);
  if (!existing) return json({ ok: false, error: "평가를 찾을 수 없어요." }, 404);
  if (!canEditCoachEvaluation(viewer, existing.evaluatorEmail)) return json({ ok: false, error: "평가를 쓴 사람과 정책 담당자만 지울 수 있어요." }, 403);
  try {
    await repository.deleteEvaluation(coachId, evaluationId, actorOf(user));
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

// --- 사실 기록 ---------------------------------------------------------------

export async function createCoachFactResponse(coachId: string, body: unknown, user: CoachEvaluationSessionUser) {
  const viewer = await resolveCoachEvaluationViewer(user);
  if (!canViewCoachEvaluations(viewer)) return denied();
  const engagementId = typeof (body as { engagementId?: unknown } | null)?.engagementId === "string" ? (body as { engagementId: string }).engagementId : "";
  if (!engagementId) return json({ ok: false, error: "기록할 투입을 골라 주세요." }, 400);

  const repository = getCoachEvaluationRepository();
  const engagement = await repository.getEngagement(coachId, engagementId);
  if (!engagement) return json({ ok: false, error: "투입 이력을 찾을 수 없어요." }, 404);
  if (!canWriteFor(viewer, engagement)) return json({ ok: false, error: "이 과정의 담당 매니저만 기록할 수 있어요." }, 403);
  const validation = validateFactRecordInput(body, engagement, seoulTodayKey());
  if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
  try {
    const fact = await repository.createFactRecord(coachId, engagementId, validation.value, actorOf(user));
    return json({ ok: true, fact: presentFact(fact, viewer) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function deleteCoachFactResponse(coachId: string, factId: string, user: CoachEvaluationSessionUser) {
  const viewer = await resolveCoachEvaluationViewer(user);
  if (!canViewCoachEvaluations(viewer)) return denied();
  const repository = getCoachEvaluationRepository();
  const existing = await repository.getFactRecord(coachId, factId);
  if (!existing) return json({ ok: false, error: "사실 기록을 찾을 수 없어요." }, 404);
  if (!canEditCoachEvaluation(viewer, existing.recordedByEmail)) return json({ ok: false, error: "기록한 사람과 정책 담당자만 지울 수 있어요." }, 403);
  try {
    await repository.deleteFactRecord(coachId, factId, actorOf(user));
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
