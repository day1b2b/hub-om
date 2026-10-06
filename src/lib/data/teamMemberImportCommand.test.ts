import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { encodePrivateJson } from "../privacy/crypto";
import { assertSafeTeamMemberImportDatabase, parseTeamMemberImportArgs, parseTeamMemberImportSource, runTeamMemberImportCommand } from "./teamMemberImportCommand";

function privacy() {
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
}
test("team-member import arguments require explicit apply confirmations", () => {
  assert.deepEqual(parseTeamMemberImportArgs([]), { apply: false }); assert.deepEqual(parseTeamMemberImportArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseTeamMemberImportArgs(["--apply", "--backup-confirmed", "--maintenance-confirmed"]), { apply: true });
  for (const args of [["--apply"], ["--apply", "--backup-confirmed"], ["--dry-run", "--apply"], ["--unknown"]]) assert.throws(() => parseTeamMemberImportArgs(args), /TEAM_MEMBER_IMPORT_FAILED/);
});
test("team-member PostgreSQL target keeps the legacy non-local write gate", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) assert.doesNotThrow(() => assertSafeTeamMemberImportDatabase(`postgresql://fixture@${host}:5432/test`, undefined));
  assert.doesNotThrow(() => assertSafeTeamMemberImportDatabase("postgresql://fixture@db.example.invalid/test", "true"));
  for (const value of [undefined, "not-a-url", "postgresql://fixture@db.example.invalid/test"]) assert.throws(() => assertSafeTeamMemberImportDatabase(value, undefined), /TEAM_MEMBER_IMPORT_FAILED/);
});
test("team-member encrypted source preserves legacy filtering and normalization", () => {
  privacy(); const source = encodePrivateJson({ members: [
    { name: "  Synthetic  One ", role: "om", sourceTeam: "1팀", roleTitle: "Private title", calendarId: "private-calendar", displayOrder: 7 },
    { name: "Synthetic Two", role: "LD", sourceTeam: "미분류" },
    { name: "ignored", role: "other", sourceTeam: "1팀" }, { name: "", role: "OM", sourceTeam: "2팀" }
  ] }, "local:team-members");
  assert.deepEqual(parseTeamMemberImportSource(source), [
    { name: "Synthetic  One", normalizedName: "syntheticone", role: "OM", sourceTeam: "TEAM_1", roleTitle: "Private title", calendarId: "private-calendar", displayOrder: 7 },
    { name: "Synthetic Two", normalizedName: "synthetictwo", role: "LD", sourceTeam: null, roleTitle: null, calendarId: null, displayOrder: 2 }
  ]);
  assert.throws(() => parseTeamMemberImportSource(JSON.stringify({ members: [] })), /Unencrypted personal data/);
});
test("team-member default command loads and closes PostgreSQL exactly once", async () => {
  privacy(); process.env.DATABASE_URL = "postgresql://fixture@127.0.0.1:5432/test"; let loaded = 0, closed = 0, called = 0; const source = encodePrivateJson({ members: [{ name: "Synthetic", role: "OM", sourceTeam: "1팀" }] }, "local:team-members");
  const output = await runTeamMemberImportCommand([], () => { loaded++; }, { readSource: async () => source, getDefaultRepository: () => ({ async importMembers(entries, apply) { called++; assert.equal(entries.length, 1); assert.equal(apply, false); return { total: 1, inserted: 1, updated: 0, deactivated: 0 }; } }), closeDefaultRepository: async () => { closed++; } });
  assert.equal(called, 1); assert.equal(loaded, 1); assert.equal(closed, 1); assert.equal(output.result.total, 1);
});
