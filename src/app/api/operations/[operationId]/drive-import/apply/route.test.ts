import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { UpdateOperationInput } from "@/lib/data/operationTypes";

let currentNote = "";
let subject: string | undefined = "google:fixture-a";
const lookup = mock.fn(async () => ({ lectureManagementNote: currentNote }));
const update = mock.fn(async (_id: string, input: UpdateOperationInput, _actor?: string) => { void _actor; return input; });
mock.module("@/lib/auth/requireWorkspaceSession", {
  namedExports: { requireWorkspaceSession: async () => ({ user: { email: "review@example.test" }, browserDraftSubject: subject }) }
});
mock.module("@/lib/data/operationRepositoryFactory", {
  namedExports: { getOperationRepository: () => ({
    getOperationById: lookup,
    updateOperation: update
  }) }
});
// Request attribution is tested separately; these tests exercise body limits and merging.
mock.module("@/lib/activity/request", { namedExports: { withActivity: (_route: string, _method: string, handler: unknown) => handler } });
const { POST } = await import("./route");

beforeEach(() => { currentNote = ""; subject = "google:fixture-a"; lookup.mock.resetCalls(); update.mock.resetCalls(); });
function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body), headers }), {
    params: Promise.resolve({ operationId: "OP-review" })
  });
}
function patch(value: string, action = "append") { return { field: "lectureManagementNote", action, value }; }

test("10만 자에 10만 자를 이어 붙이면 저장 없이 413을 반환한다", async () => {
  currentNote = "a".repeat(100_000);
  const response = await post({ patches: [patch("b".repeat(100_000))] });
  assert.equal(response.status, 413);
  assert.equal(update.mock.callCount(), 0);
});

test("구분 줄바꿈을 포함한 최종 값이 상한이면 저장하고 한 자 초과는 거절한다", async () => {
  currentNote = "a".repeat(99_997);
  assert.equal((await post({ patches: [patch("b")] })).status, 200);
  assert.equal(update.mock.calls[0].arguments[1].lectureManagementNote?.length, 100_000);
  update.mock.resetCalls();
  currentNote += "a";
  assert.equal((await post({ patches: [patch("b")] })).status, 413);
  assert.equal(update.mock.callCount(), 0);
});

test("기존 초과 기록을 짧게 교체하면 복구할 수 있다", async () => {
  currentNote = "a".repeat(200_000);
  assert.equal((await post({ patches: [patch("short", "replace")] })).status, 200);
  assert.deepEqual(update.mock.calls[0].arguments, ["OP-review", { lectureManagementNote: "short" }, "review@example.test"]);
});

test("이미 포함된 텍스트를 다시 append해도 중복 저장하지 않는다", async () => {
  currentNote = "a".repeat(100_000);
  assert.equal((await post({ patches: [patch("aaa")] })).status, 200);
  assert.equal(update.mock.calls[0].arguments[1].lectureManagementNote, currentNote);
});

test("뒤 항목이 상한을 넘으면 앞 항목도 부분 저장하지 않는다", async () => {
  const response = await post({ patches: [{ field: "padletLink", value: "https://example.test", action: "replace" }, patch("x".repeat(100_001), "replace")] });
  assert.equal(response.status, 413);
  assert.equal(update.mock.callCount(), 0);
});

test("실제 요청 본문이 2MB를 넘으면 헤더 유무와 무관하게 저장하지 않는다", async () => {
  const headerCases: Record<string, string>[] = [{}, { "content-length": "1" }];
  for (const headers of headerCases) {
    const response = await post({ patches: [patch("ok", "replace")], ignored: "x".repeat(2_100_000) }, headers);
    assert.equal(response.status, 413);
  }
  assert.equal(update.mock.callCount(), 0);
});

test("null 본문과 null patch는 500 대신 400으로 반환한다", async () => {
  assert.equal((await post(null)).status, 400);
  assert.equal((await post({ patches: [null] })).status, 400);
  assert.equal(update.mock.callCount(), 0);
});


test("재개 계정이 바뀌었거나 실제 subject가 없으면 Drive 적용 조회/쓰기 전409이다", async () => {
  for (const actual of ["google:fixture-b", undefined, ""]) {
    subject = actual;
    const response = await post({ patches: [patch("fixture", "replace")] }, { "X-Operation-Submission-Subject": "google:fixture-a" });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "로그인 계정이 변경되었습니다. 원래 계정으로 로그인한 뒤 등록을 재개해주세요.");
    assert.equal(lookup.mock.callCount(), 0);
    assert.equal(update.mock.callCount(), 0);
  }
});
test("일치하는 재개 헤더와 헤더 없는 기존 Drive 적용은 모두 지원한다", async () => {
  assert.equal((await post({ patches: [patch("fixture", "replace")] }, { "X-Operation-Submission-Subject": "google:fixture-a" })).status, 200);
  subject = undefined;
  assert.equal((await post({ patches: [patch("legacy", "replace")] })).status, 200);
  assert.equal(update.mock.callCount(), 2);
});
