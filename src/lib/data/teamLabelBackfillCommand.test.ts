import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { runTeamLabelBackfillCommand } from "./teamLabelBackfillCommand";
import type { TeamUserRepository } from "./teamUsers/teamUserRepositoryContract";
import type { TeamUser } from "./teamUsers/teamUserTypes";

const user = (id: string, team: string): TeamUser => ({ id, team, name: `Synthetic ${id}`, email: `${id}@example.invalid`, slackId: id, createdAt: "2099-01-01T00:00:00.000Z" });
function fixture(fail = false) {
  const users = [user("a", "1팀"), user("b", "2팀"), user("c", "AX 1파트")], calls: string[] = [];
  const value: TeamUserRepository = {
    async listTeamUsers() { if (fail) throw new Error("private canary"); return users; },
    async countTeamUsersByTeam(team) { if (fail) throw new Error("private canary"); return users.filter(row => row.team === team).length; },
    async renameTeamUsers(from, to) { calls.push(`${from}->${to}`); let count = 0; for (const row of users) if (row.team === from) { row.team = to; count++; } return count; },
    async findTeamUsersByEmail() { return []; }, async createTeamUser() { throw new Error("unexpected"); }, async deleteTeamUsers() { throw new Error("unexpected"); },
    async updateTeamUserTeam() { throw new Error("unexpected"); }, async updateTeamUsersRole() { throw new Error("unexpected"); },
  };
  return { value, calls, users };
}

test("team label backfill preserves dry-run and exact two-label apply without env access", async () => {
  const dry = fixture(), apply = fixture(), load = () => { throw new Error("unexpected env"); };
  const dryResult = await runWithDataRepositories({ teamUsers: dry.value }, () => runTeamLabelBackfillCommand([], {}, load));
  assert.deepEqual(dryResult.rows.map(row => [row.from, row.to, row.targetCount, row.updatedCount]), [["1팀", "AX 1파트", 1, 0], ["2팀", "AX 2파트", 1, 0]]); assert.deepEqual(dry.calls, []); assert.deepEqual(dry.users.map(row => row.team), ["1팀", "2팀", "AX 1파트"]);
  const applyResult = await runWithDataRepositories({ teamUsers: apply.value }, () => runTeamLabelBackfillCommand(["--apply", "ignored"], {}, load));
  assert.deepEqual(applyResult.rows.map(row => row.updatedCount), [1, 1]); assert.deepEqual(apply.calls, ["1팀->AX 1파트", "2팀->AX 2파트"]); assert.deepEqual(apply.users.map(row => row.team), ["AX 1파트", "AX 2파트", "AX 1파트"]);
});

test("team label backfill closes only default PG and redacts failures", async () => {
  for (const fail of [false, true]) { const f = fixture(fail); let loaded = 0, closed = 0; const result = runTeamLabelBackfillCommand([], { DATABASE_URL: "postgresql://synthetic" }, () => { loaded++; }, { getDefaultRepository: async () => f.value, closeDefaultRepository: async () => { closed++; } }); if (fail) await assert.rejects(result, /^Error: TEAM_LABEL_BACKFILL_FAILED$/); else await result; assert.equal(loaded, 1); assert.equal(closed, 1); }
  const scoped = fixture(); let closed = 0; await runWithDataRepositories({ teamUsers: scoped.value }, () => runTeamLabelBackfillCommand([], {}, () => {}, { getDefaultRepository: async () => scoped.value, closeDefaultRepository: async () => { closed++; } })); assert.equal(closed, 0);
});

test("team label backfill rejects local-file selection before opening or changing it", async () => {
  let opened = 0, closed = 0;
  await assert.rejects(runTeamLabelBackfillCommand(["--apply"], { DATABASE_URL: "postgresql://synthetic", OPERATION_DATA_SOURCE: " local " }, () => {}, { getDefaultRepository: async () => { opened++; return fixture().value; }, closeDefaultRepository: async () => { closed++; } }), /^Error: TEAM_LABEL_BACKFILL_FAILED$/);
  assert.equal(opened, 0); assert.equal(closed, 1);
});

for (const scenario of ["dry-run", "apply", "failure"] as const) test(`real team label CLI ${scenario} keeps counts-only output`, () => {
  const source = `import{mock}from'node:test';mock.module('dotenv',{namedExports:{config(){throw Error('UNEXPECTED_ENV')}}});const{runWithDataRepositories}=await import('./src/lib/data/dataRepositoryContext.ts');process.argv=['node','script'${scenario === "apply" ? ",'--apply'" : ""}];const rows=[{id:'a',name:'A',email:'a@example.invalid',slackId:'a',team:'1팀',createdAt:'2099-01-01T00:00:00.000Z'},{id:'b',name:'B',email:'b@example.invalid',slackId:'b',team:'2팀',createdAt:'2099-01-01T00:00:00.000Z'}];const repo={async countTeamUsersByTeam(t){${scenario === "failure" ? "throw Error('private-canary')" : "return rows.filter(r=>r.team===t).length"}},async renameTeamUsers(f,t){let n=0;for(const r of rows)if(r.team===f){r.team=t;n++}return n}};await runWithDataRepositories({teamUsers:repo},()=>import('./scripts/backfill-team-user-team-labels.ts'));`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-test-module-mocks", "--experimental-loader", "./scripts/ts-loader.mjs", "--input-type=module", "-e", source], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", NODE_ENV: "test" } });
  assert.equal(result.error, undefined); assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_ENV|private-canary|Error:|\bat .*\(/); const mode = `[backfill-team-user-team-labels] 모드: ${scenario === "apply" ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}\n`;
  if (scenario === "failure") { assert.equal(result.status, 1); assert.equal(result.stdout, mode); assert.match(result.stderr, /^\[backfill-team-user-team-labels\] 실패\./); }
  else { assert.equal(result.status, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, mode + (scenario === "apply" ? `[backfill-team-user-team-labels] apply: "1팀" -> "AX 1파트" 1건 갱신\n[backfill-team-user-team-labels] apply: "2팀" -> "AX 2파트" 1건 갱신\n` : `[backfill-team-user-team-labels] dry-run: "1팀" -> "AX 1파트" 대상 1건\n[backfill-team-user-team-labels] dry-run: "2팀" -> "AX 2파트" 대상 1건\n`)); }
});
