import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runWithDataRepositories } from "../dataRepositoryContext";
import * as facade from "./teamUserRepository";
import { TEAM_OPTIONS } from "./teamUserTypes";
import type { TeamUserRepository } from "./teamUserRepositoryContract";
import { MongoOperationError } from "../mongoOperationStore";

type Handler = (request: Request) => Promise<Response>;
let allowed = false;
function route(relative: string): Record<string, Handler> {
  const source = readFileSync(new URL(`../../..${relative}`, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules: Record<string, unknown> = {
    "@/lib/activity/request": { withActivity: (_route: string, _method: string, handler: Handler) => handler },
    "next/server": { NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) } },
    "@/lib/auth/apiAdminGuard": { denyIfNotAdmin: async () => allowed ? null : Response.json({ error: "Synthetic denied" }, { status: 403 }) },
    "@/lib/data/teamUsers/teamUserRepository": facade,
    "@/lib/data/teamUsers/teamUserTypes": { TEAM_OPTIONS }
  };
  const exports: Record<string, Handler> = {};
  new Function("require", "exports", javascript)((name: string) => { assert.ok(Object.hasOwn(modules, name), "unexpected route import"); return modules[name]; }, exports);
  return exports;
}
const admin = route("/app/api/admin/users/route.ts"), team = route("/app/api/admin/users/team/route.ts"), role = route("/app/api/admin/users/role/route.ts"), deletion = route("/app/api/admin/users/delete/route.ts"), lookup = route("/app/api/team-users/lookup/route.ts");
function request(body?: unknown, query = "") { return new Request(`https://synthetic.invalid/${query}`, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }); }
function target() {
  const calls: string[] = [];
  const user = { id: "synthetic-id", name: " Synthetic member ", email: " MEMBER@example.invalid ", slackId: "private-slack", team: "AX 1파트", role: "om" as const, createdAt: "2026-01-01T00:00:00.000Z" };
  const repository: TeamUserRepository = {
    async listTeamUsers() { calls.push("list"); return [user]; }, async findTeamUsersByEmail() { calls.push("find"); return [user]; },
    async createTeamUser() { calls.push("create"); return user; }, async updateTeamUserTeam() { calls.push("team"); return user; },
    async updateTeamUsersRole() { calls.push("role"); return 1; }, async deleteTeamUsers() { calls.push("delete"); throw new MongoOperationError("TEAM_USER_DELETE_POLICY_REQUIRED"); }
  };
  return { repository, calls };
}
test("Existing admin user handlers keep authorization before injected reads and writes", async () => {
  const state = target(); allowed = false;
  await runWithDataRepositories({ teamUsers: state.repository }, async () => {
    for (const handler of [admin.GET, admin.POST, team.POST, role.POST, deletion.POST]) assert.equal((await handler(request({}))).status, 403);
  });
  assert.deepEqual(state.calls, []);
  allowed = true;
  await runWithDataRepositories({ teamUsers: state.repository }, async () => {
    assert.equal((await admin.GET(request())).status, 200);
    assert.equal((await admin.POST(request({ name: "Synthetic", email: "synthetic@example.invalid", slackId: "" }))).status, 201);
    assert.equal((await team.POST(request({ id: "synthetic-id", team: "AX 1파트" }))).status, 200);
    assert.equal((await role.POST(request({ ids: ["synthetic-id"], role: "ld" }))).status, 200);
    assert.equal((await deletion.POST(request({ ids: ["synthetic-id"] }))).status, 500, "Blocked Mongo deletion must not fall back to legacy physical delete");
  });
  assert.deepEqual(state.calls, ["list", "create", "team", "role", "delete"]);
});
test("Existing lookup handler requires token and exposes only name/email from injected roster", async () => {
  const saved = process.env.COURSE_LOOKUP_TOKEN; process.env.COURSE_LOOKUP_TOKEN = "synthetic-only-token";
  try {
    const state = target();
    await runWithDataRepositories({ teamUsers: state.repository }, async () => {
      assert.equal((await lookup.GET(request())).status, 401); assert.deepEqual(state.calls, []);
      const response = await lookup.GET(request(undefined, "?token=synthetic-only-token"));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, count: 1, members: [{ email: "member@example.invalid", name: "Synthetic member" }] });
    });
  } finally { if (saved === undefined) delete process.env.COURSE_LOOKUP_TOKEN; else process.env.COURSE_LOOKUP_TOKEN = saved; }
});
