import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { CoachEvaluationRecord, CoachEvaluationRepository } from "../data/coachEvaluationRepository";
import type { TeamUserRepository } from "../data/teamUsers/teamUserRepositoryContract";

const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" ? `${specifier}.js` : specifier, context); } });
const service = await import("./coachEvaluationService");
const { CoachEvaluationError } = await import("../data/coachEvaluationRepository");
const { runWithDataRepositories } = await import("../data/dataRepositoryContext");
hooks.deregister();

const COACH = "11111111-1111-4111-8111-111111111111";
const ENDED = "22222222-2222-4222-8222-222222222222";
const UPCOMING = "33333333-3333-4333-8333-333333333333";
const om = { email: "om@day1company.co.kr", name: "가상 OM" };
const otherOm = { email: "om2@day1company.co.kr", name: "가상 OM2" };
const intern = { email: "intern@day1company.co.kr", name: "가상 인턴" };
const owner = { email: "owner@day1company.co.kr", name: "가상 담당자" };
const body = { engagementId: ENDED, role: "PRACTICE_COACH", scores: { practiceSupport: 4, fieldOperation: 4, communication: 4, punctuality: 4 }, rehire: "YES" };

function fakeRepository() {
  const evaluations: CoachEvaluationRecord[] = [];
  const calls: string[] = [];
  const engagement = (id: string) => id === ENDED
    ? { id, coachId: COACH, courseName: "가상 과정", startDate: "2000-01-01", endDate: "2000-01-02" }
    : id === UPCOMING ? { id, coachId: COACH, courseName: "가상 예정", startDate: "2999-01-01", endDate: "2999-01-02" } : null;
  const repository: CoachEvaluationRepository = {
    async getEngagement(_coachId, id) { return engagement(id); },
    async listForCoach() { calls.push("list"); return { evaluations: [...evaluations], details: [] }; },
    async getEvaluation(_coachId, id) { return evaluations.find((item) => item.id === id) ?? null; },
    async createOmEvaluation(coachId, engagementId, input, actor) {
      calls.push("create");
      if (evaluations.some((item) => item.engagementId === engagementId)) throw new CoachEvaluationError("ALREADY_EVALUATED");
      const ref = engagement(engagementId)!;
      const record: CoachEvaluationRecord = { id: `ev-${evaluations.length + 1}`, coachId, engagementId, source: "OM", courseName: ref.courseName, startDate: ref.startDate, endDate: ref.endDate,
        scores: input.scores, rehire: input.rehire, rehireReason: input.rehireReason, evidence: input.evidence, evaluatorEmail: actor.email, evaluatorName: actor.name,
        createdAt: new Date(0), updatedAt: new Date(0) };
      evaluations.push(record);
      return record;
    },
    async updateOmEvaluation(_coachId, id, input) { calls.push("update"); const item = evaluations.find((row) => row.id === id)!; Object.assign(item, { scores: input.scores }); return item; },
    async deleteEvaluation(_coachId, id) { calls.push("delete"); evaluations.splice(evaluations.findIndex((row) => row.id === id), 1); },
    async listOmAverageInputs() { return []; }
  };
  return { repository, evaluations, calls };
}

const teamUsers = {
  async findTeamUsersByEmail(email: string | null | undefined) {
    if (email === om.email || email === otherOm.email) return [{ id: "t1", name: "가상", email, team: null, role: "om" as const }];
    return [];
  }
} as unknown as TeamUserRepository;

async function run<T>(repository: CoachEvaluationRepository, work: () => Promise<T>): Promise<T> {
  return runWithDataRepositories({ coachEvaluation: repository, teamUsers }, work);
}
async function read(response: Response) { return { status: response.status, body: await response.json() as Record<string, unknown> }; }

test("OM·LD가 아니면 평가 원문을 받지 않고, 작성도 못 한다", async () => {
  const { repository, calls } = fakeRepository();
  await run(repository, async () => {
    const list = await read(await service.listCoachEvaluationsResponse(COACH, intern));
    assert.equal(list.body.canView, false);
    assert.deepEqual(list.body.evaluations, []);
    assert.equal((await service.createCoachEvaluationResponse(COACH, body, intern)).status, 403);
  });
  assert.deepEqual(calls, []);
});

test("OM은 끝난 투입만 평가하고, 같은 투입을 두 번 평가하지 못한다", async () => {
  const { repository, evaluations } = fakeRepository();
  await run(repository, async () => {
    const created = await read(await service.createCoachEvaluationResponse(COACH, body, om));
    assert.equal(created.status, 200);
    assert.equal(evaluations[0].evaluatorEmail, om.email);
    assert.equal((created.body.evaluation as { canEdit: boolean }).canEdit, true);
    assert.equal((await service.createCoachEvaluationResponse(COACH, body, otherOm)).status, 409);
    assert.equal((await service.createCoachEvaluationResponse(COACH, { ...body, engagementId: UPCOMING }, om)).status, 400);
    assert.equal((await service.createCoachEvaluationResponse(COACH, { ...body, engagementId: "44444444-4444-4444-8444-444444444444" }, om)).status, 404);
    assert.equal((await service.createCoachEvaluationResponse(COACH, { ...body, rehire: "NO" }, om)).status, 400);
  });
});

test("수정·삭제는 작성자와 정책 담당자만 한다", async () => {
  const { repository, calls } = fakeRepository();
  const saved = process.env.COACH_POLICY_OWNER_EMAILS;
  process.env.COACH_POLICY_OWNER_EMAILS = owner.email;
  try {
    await run(repository, async () => {
      await service.createCoachEvaluationResponse(COACH, body, om);
      const list = await read(await service.listCoachEvaluationsResponse(COACH, otherOm));
      assert.equal((list.body.evaluations as Array<{ canEdit: boolean }>)[0].canEdit, false);
      assert.equal((await service.updateCoachEvaluationResponse(COACH, "ev-1", body, otherOm)).status, 403);
      assert.equal((await service.deleteCoachEvaluationResponse(COACH, "ev-1", otherOm)).status, 403);
      // 정책 담당자는 팀원 명단에 없어도 보고 고칠 수 있다.
      assert.equal((await service.updateCoachEvaluationResponse(COACH, "ev-1", body, owner)).status, 200);
      assert.equal((await service.deleteCoachEvaluationResponse(COACH, "ev-1", om)).status, 200);
      assert.equal((await service.deleteCoachEvaluationResponse(COACH, "ev-1", om)).status, 404);
    });
  } finally {
    if (saved === undefined) delete process.env.COACH_POLICY_OWNER_EMAILS; else process.env.COACH_POLICY_OWNER_EMAILS = saved;
  }
  assert.deepEqual(calls.filter((call) => call !== "list"), ["create", "update", "delete"]);
});

test("팀원 명단 조회가 실패하면 권한을 주지 않는다", async () => {
  const { repository } = fakeRepository();
  const broken = { async findTeamUsersByEmail() { throw new Error("synthetic roster failure"); } } as unknown as TeamUserRepository;
  await runWithDataRepositories({ coachEvaluation: repository, teamUsers: broken }, async () => {
    assert.equal((await read(await service.listCoachEvaluationsResponse(COACH, om))).body.canView, false);
  });
});
