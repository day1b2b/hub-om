import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { CoachEvaluationEngagementRef, CoachEvaluationRecord, CoachEvaluationRepository } from "../data/coachEvaluationRepository";
import type { TeamUserRepository } from "../data/teamUsers/teamUserRepositoryContract";

const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" ? `${specifier}.js` : specifier, context); } });
const service = await import("./coachEvaluationService");
const { CoachEvaluationError } = await import("../data/coachEvaluationRepository");
const { runWithDataRepositories } = await import("../data/dataRepositoryContext");
hooks.deregister();

const COACH = "11111111-1111-4111-8111-111111111111";
// 운영현황 회차에 연결된 투입(담당 OM = 가상 OM, 현장 OM = 가상 현장)
const ENDED = "22222222-2222-4222-8222-222222222222";
const UPCOMING = "33333333-3333-4333-8333-333333333333";
// 운영현황 연결이 없고 계약 요청자만 있는 투입
const CONTRACT_ONLY = "55555555-5555-4555-8555-555555555555";
// 담당을 알 수 없는 투입
const UNKNOWN = "66666666-6666-4666-8666-666666666666";
const om = { email: "om@day1company.co.kr", name: "가상 OM" };
const otherOm = { email: "om2@day1company.co.kr", name: "가상 OM2" };
const onsite = { email: "onsite@day1company.co.kr", name: "가상 현장" };
const intern = { email: "intern@day1company.co.kr", name: "가상 인턴" };
const owner = { email: "owner@day1company.co.kr", name: "가상 담당자" };
const scores = { practiceSupport: 4, fieldOperation: 4, communication: 4, punctuality: 4 };
const body = (engagementId: string) => ({ engagementId, role: "PRACTICE_COACH", scores, rehire: "YES" });

const ENGAGEMENTS: CoachEvaluationEngagementRef[] = [
  { id: ENDED, coachId: COACH, courseName: "가상 과정", startDate: "2000-01-01", endDate: "2000-01-02", operationManagers: ["가상 OM", "가상 현장(오후)"], contractRequester: "가상 OM2" },
  { id: UPCOMING, coachId: COACH, courseName: "가상 예정", startDate: "2999-01-01", endDate: "2999-01-02", operationManagers: ["가상 OM"], contractRequester: null },
  { id: CONTRACT_ONLY, coachId: COACH, courseName: "가상 계약", startDate: "2000-02-01", endDate: "2000-02-01", operationManagers: [], contractRequester: "가상 OM2" },
  { id: UNKNOWN, coachId: COACH, courseName: "가상 미상", startDate: "2000-03-01", endDate: "2000-03-01", operationManagers: [], contractRequester: null }
];

function fakeRepository() {
  const evaluations: CoachEvaluationRecord[] = [];
  const calls: string[] = [];
  const engagement = (id: string) => ENGAGEMENTS.find((item) => item.id === id) ?? null;
  const repository: CoachEvaluationRepository = {
    async getEngagement(_coachId, id) { return engagement(id); },
    async listForCoach() { calls.push("list"); return { evaluations: [...evaluations], details: [], engagements: ENGAGEMENTS }; },
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

const roster = new Map([[om.email, om.name], [otherOm.email, otherOm.name], [onsite.email, onsite.name]]);
const teamUsers = {
  async findTeamUsersByEmail(email: string | null | undefined) {
    const name = email ? roster.get(email) : undefined;
    return name ? [{ id: `t-${name}`, name, email, team: null, role: "om" as const }] : [];
  }
} as unknown as TeamUserRepository;

async function run<T>(repository: CoachEvaluationRepository, work: () => Promise<T>): Promise<T> {
  return runWithDataRepositories({ coachEvaluation: repository, teamUsers }, work);
}
async function read(response: Response) { return { status: response.status, body: await response.json() as Record<string, unknown> }; }
async function withOwner<T>(work: () => Promise<T>): Promise<T> {
  const saved = process.env.COACH_POLICY_OWNER_EMAILS;
  process.env.COACH_POLICY_OWNER_EMAILS = owner.email;
  try { return await work(); } finally {
    if (saved === undefined) delete process.env.COACH_POLICY_OWNER_EMAILS; else process.env.COACH_POLICY_OWNER_EMAILS = saved;
  }
}

test("OM·LD가 아니면 평가 원문을 받지 않고, 작성도 못 한다", async () => {
  const { repository, calls } = fakeRepository();
  await run(repository, async () => {
    const list = await read(await service.listCoachEvaluationsResponse(COACH, intern));
    assert.equal(list.body.canView, false);
    assert.deepEqual(list.body.evaluations, []);
    assert.equal((await service.createCoachEvaluationResponse(COACH, body(ENDED), intern)).status, 403);
  });
  assert.deepEqual(calls, []);
});

test("평가 쓰기는 운영현황 담당 OM·현장 OM, 연결이 없으면 계약 요청자만", async () => {
  const { repository, evaluations } = fakeRepository();
  await run(repository, async () => {
    // 목록에는 이 사람이 쓸 수 있는 투입 ID만 내려간다(담당자 이름은 안 내려감).
    assert.deepEqual((await read(await service.listCoachEvaluationsResponse(COACH, om))).body.writableEngagementIds, [ENDED, UPCOMING]);
    assert.deepEqual((await read(await service.listCoachEvaluationsResponse(COACH, otherOm))).body.writableEngagementIds, [CONTRACT_ONLY]);

    // 운영현황이 연결돼 있으면 계약 요청자는 담당이 아니다.
    assert.equal((await service.createCoachEvaluationResponse(COACH, body(ENDED), otherOm)).status, 403);
    // 현장 OM 이름은 괄호 주석을 빼고 맞춘다.
    assert.equal((await service.createCoachEvaluationResponse(COACH, body(ENDED), onsite)).status, 200);
    assert.equal(evaluations[0].evaluatorEmail, onsite.email);
    // 같은 투입은 두 번 평가하지 않는다.
    assert.equal((await service.createCoachEvaluationResponse(COACH, body(ENDED), om)).status, 409);

    assert.equal((await service.createCoachEvaluationResponse(COACH, body(CONTRACT_ONLY), om)).status, 403);
    assert.equal((await service.createCoachEvaluationResponse(COACH, body(CONTRACT_ONLY), otherOm)).status, 200);
    assert.equal((await service.createCoachEvaluationResponse(COACH, body(UNKNOWN), om)).status, 403);
  });
});

test("정책 담당자는 담당을 알 수 없는 투입도 평가한다", async () => {
  const { repository } = fakeRepository();
  await withOwner(() => run(repository, async () => {
    const list = await read(await service.listCoachEvaluationsResponse(COACH, owner));
    assert.deepEqual(list.body.writableEngagementIds, ENGAGEMENTS.map((item) => item.id));
    assert.equal((await service.createCoachEvaluationResponse(COACH, body(UNKNOWN), owner)).status, 200);
  }));
});

test("끝나지 않은 투입·없는 투입·잘못된 입력은 거절한다", async () => {
  const { repository } = fakeRepository();
  await run(repository, async () => {
    assert.equal((await service.createCoachEvaluationResponse(COACH, body(UPCOMING), om)).status, 400);
    assert.equal((await service.createCoachEvaluationResponse(COACH, body("44444444-4444-4444-8444-444444444444"), om)).status, 404);
    assert.equal((await service.createCoachEvaluationResponse(COACH, { ...body(ENDED), rehire: "NO" }, om)).status, 400);
  });
});

test("수정·삭제는 작성자와 정책 담당자만 한다", async () => {
  const { repository, calls } = fakeRepository();
  await withOwner(() => run(repository, async () => {
    await service.createCoachEvaluationResponse(COACH, body(ENDED), om);
    const list = await read(await service.listCoachEvaluationsResponse(COACH, onsite));
    assert.equal((list.body.evaluations as Array<{ canEdit: boolean }>)[0].canEdit, false);
    // 같은 과정 담당이어도 작성자가 아니면 못 고친다.
    assert.equal((await service.updateCoachEvaluationResponse(COACH, "ev-1", body(ENDED), onsite)).status, 403);
    assert.equal((await service.deleteCoachEvaluationResponse(COACH, "ev-1", otherOm)).status, 403);
    // 정책 담당자는 팀원 명단에 없어도 보고 고칠 수 있다.
    assert.equal((await service.updateCoachEvaluationResponse(COACH, "ev-1", body(ENDED), owner)).status, 200);
    assert.equal((await service.deleteCoachEvaluationResponse(COACH, "ev-1", om)).status, 200);
    assert.equal((await service.deleteCoachEvaluationResponse(COACH, "ev-1", om)).status, 404);
  }));
  assert.deepEqual(calls.filter((call) => call !== "list"), ["create", "update", "delete"]);
});

test("팀원 명단 조회가 실패하면 권한을 주지 않는다", async () => {
  const { repository } = fakeRepository();
  const broken = { async findTeamUsersByEmail() { throw new Error("synthetic roster failure"); } } as unknown as TeamUserRepository;
  await runWithDataRepositories({ coachEvaluation: repository, teamUsers: broken }, async () => {
    assert.equal((await read(await service.listCoachEvaluationsResponse(COACH, om))).body.canView, false);
  });
});
