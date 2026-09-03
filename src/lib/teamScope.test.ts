import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTeamScope } from "@/lib/teamScope.ts";
import type { ResourceOwnerRoster } from "@/lib/data/teamMemberRepository.ts";
import type { Session } from "next-auth";

function session(name: string, email: string): Session {
  return { user: { name, email }, expires: "2099-01-01" } as Session;
}

const LEGACY_ROSTER: ResourceOwnerRoster = {
  "1팀": ["공새봄"],
  "2팀": ["홍예진"]
};

test("로그인 계정 이름이 레거시 1·2팀 명단과 우연히 겹쳐도 자동으로 스코프를 좁히지 않는다", () => {
  const scope = resolveTeamScope({}, session("홍예진", "yejin.hong@day1company.co.kr"), LEGACY_ROSTER);
  assert.equal(scope, "both");
});

test("?team= 파라미터가 명시되면 그 값을 그대로 쓴다", () => {
  const scope = resolveTeamScope(
    { team: "team_1" },
    session("홍예진", "yejin.hong@day1company.co.kr"),
    LEGACY_ROSTER
  );
  assert.equal(scope, "team_1");
});

test("파라미터도 없고 매칭될 이름도 없으면 전체를 본다", () => {
  const scope = resolveTeamScope({}, session("아무개", "someone@day1company.co.kr"), LEGACY_ROSTER);
  assert.equal(scope, "both");
});
