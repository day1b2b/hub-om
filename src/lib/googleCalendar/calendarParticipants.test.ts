import assert from "node:assert/strict";
import { test } from "node:test";

import type { OperationSession } from "@/lib/data/operationTypes";
import type { TeamUser } from "@/lib/data/teamUsers/teamUserTypes.ts";
import { resolveCalendarTargetsFromUsers } from "@/lib/googleCalendar/calendarParticipants.ts";

function user(name: string, team: string, email = `${name}@day1company.co.kr`): TeamUser {
  return { id: name, name, email, slackId: name, team, createdAt: "2026-01-01T00:00:00.000Z" };
}

function operationFixture(overrides: Partial<OperationSession> = {}): OperationSession {
  return {
    operationId: "OP-1",
    companyName: "신한라이프",
    courseName: "디지털·ICT 성능 최적화",
    roundNo: "1",
    om: "이수경D",
    onsiteOm: "",
    ld: "강연정",
    startDate: "2026-09-28",
    endDate: "2026-09-28",
    educationDates: ["2026-09-28"],
    ...overrides
  } as OperationSession;
}

test("담당 OM으로 파트를 정한다(LD는 파트 판정에 안 쓰임)", () => {
  const targets = resolveCalendarTargetsFromUsers(operationFixture(), [
    user("이수경D", "AX 3파트"),
    user("강연정", "AX 1파트") // OM으로 이미 정해지므로 LD 파트는 무시
  ]);

  assert.equal(targets.partKey, "3파트");
  assert.deepEqual(targets.attendeeEmails, ["이수경D@day1company.co.kr"]);
});

test("담당 OM이 비어 있으면 요청 LD 소속 파트로 정한다(OM 후지정 사각지대 방지)", () => {
  // om-request 접수 직후: OM이 아직 없음. LD(강연정=AX 3파트)로 파트를 정해 생성 시점에 반영한다.
  const targets = resolveCalendarTargetsFromUsers(operationFixture({ om: "", onsiteOm: "" }), [
    user("강연정", "AX 3파트")
  ]);

  assert.equal(targets.partKey, "3파트");
});

test("LD는 파트 판정에만 쓰고 초대 대상에는 넣지 않는다(D3)", () => {
  const targets = resolveCalendarTargetsFromUsers(operationFixture({ om: "", onsiteOm: "" }), [
    user("강연정", "AX 3파트")
  ]);

  // 초대는 담당·현장 OM만. OM이 비어 있으니 초대 대상도 없어야 한다(LD 이메일이 새 들어가면 안 됨).
  assert.deepEqual(targets.attendeeEmails, []);
});

test("담당 OM은 있지만 소속에서 파트를 못 뽑으면 LD 파트로 떨어진다", () => {
  const targets = resolveCalendarTargetsFromUsers(operationFixture({ om: "홍길동" }), [
    user("홍길동", "영업지원"), // 파트(1/2/3) 아님 → 못 뽑음
    user("강연정", "AX 2파트")
  ]);

  assert.equal(targets.partKey, "2파트");
});

test("OM·LD 둘 다 파트를 못 뽑으면 partKey는 null", () => {
  const targets = resolveCalendarTargetsFromUsers(operationFixture({ om: "홍길동", ld: "김철수" }), [
    user("홍길동", "영업지원"),
    user("김철수", "2팀")
  ]);

  assert.equal(targets.partKey, null);
});

test("배정 전 자리표시자(배정필요)는 OM으로 치지 않아 LD 파트로 떨어진다", () => {
  const targets = resolveCalendarTargetsFromUsers(operationFixture({ om: "배정필요", onsiteOm: "" }), [
    user("강연정", "AX 3파트")
  ]);

  assert.equal(targets.partKey, "3파트");
  assert.deepEqual(targets.attendeeEmails, []);
});
