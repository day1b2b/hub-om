import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { disconnectPrismaClient, getPrismaClient } from "./prisma";
import { PrismaTeamMemberImportRepository } from "./prismaTeamMemberImportRepository";
import type { TeamMemberImportEntry } from "./teamMemberImportRepository";

const url = process.env.TEAM_MEMBER_IMPORT_PG_TEST_DATABASE_URL;
test("team-member import is encrypted, atomic and repeatable on PostgreSQL", { skip: !url, timeout: 120_000 }, async () => {
  const parsed = new URL(url!); assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname));
  const names = ["DATABASE_URL", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const saved = new Map(names.map(name => [name, process.env[name]])); const raw = new pg.Client({ connectionString: url });
  Object.assign(process.env, { DATABASE_URL: url, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const entry = (name: string, role: "OM" | "LD", sourceTeam: "TEAM_1" | "TEAM_2" | null, displayOrder: number): TeamMemberImportEntry => ({ name, normalizedName: name.replace(/\s+/g, "").toLowerCase(), role, sourceTeam, roleTitle: `${name} title`, calendarId: `${name} calendar`, displayOrder });
  try {
    await raw.connect(); await raw.query("TRUNCATE members"); const db = getPrismaClient(), repo = new PrismaTeamMemberImportRepository(db);
    await db.member.create({ data: { ...entry("Synthetic Existing", "OM", "TEAM_1", 1), isActive: false } });
    await db.member.create({ data: { ...entry("Synthetic Omitted", "OM", "TEAM_1", 2), isActive: true } });
    await db.member.create({ data: { ...entry("Synthetic Other Group", "LD", "TEAM_2", 3), isActive: true } });
    const entries = [entry("Synthetic Existing", "OM", "TEAM_1", 9), entry("Synthetic Unclassified", "LD", null, 4)];
    const before = await raw.query("SELECT * FROM members ORDER BY id");
    assert.deepEqual(await repo.importMembers(entries, false), { total: 2, inserted: 1, updated: 1, deactivated: 1 });
    assert.deepEqual((await raw.query("SELECT * FROM members ORDER BY id")).rows, before.rows);
    assert.deepEqual(await repo.importMembers(entries, true), { total: 2, inserted: 1, updated: 1, deactivated: 1 });
    const logical = await db.member.findMany({ orderBy: { displayOrder: "asc" } });
    assert.equal(logical.find(row => row.name === "Synthetic Existing")?.isActive, true); assert.equal(logical.find(row => row.name === "Synthetic Existing")?.displayOrder, 9);
    assert.equal(logical.find(row => row.name === "Synthetic Omitted")?.isActive, false); assert.equal(logical.find(row => row.name === "Synthetic Other Group")?.isActive, true);
    assert.equal(logical.find(row => row.name === "Synthetic Unclassified")?.sourceTeam, null);
    assert.deepEqual(await repo.importMembers(entries, true), { total: 2, inserted: 0, updated: 2, deactivated: 0 });
    const legacyDuplicate = entry("Synthetic Legacy Duplicate", "LD", null, 6);
    await db.member.create({ data: { ...legacyDuplicate, isActive: false } }); await db.member.create({ data: { ...legacyDuplicate, isActive: false, displayOrder: 7 } });
    assert.deepEqual(await repo.importMembers([legacyDuplicate], false), { total: 1, inserted: 0, updated: 1, deactivated: 1 });
    assert.deepEqual(await repo.importMembers([legacyDuplicate], true), { total: 1, inserted: 0, updated: 1, deactivated: 1 });
    const duplicates = await db.member.findMany({ where: { role: "LD", sourceTeam: null, normalizedName: legacyDuplicate.normalizedName } });
    assert.equal(duplicates.length, 2); assert.ok(duplicates.every(row => row.isActive && row.displayOrder === 6));
    const stored = JSON.stringify((await raw.query("SELECT * FROM members")).rows);
    for (const plaintext of ["Synthetic Existing", "Synthetic Unclassified", "Synthetic Existing title", "Synthetic Unclassified calendar"]) assert.equal(stored.includes(plaintext), false);
    const snapshot = await raw.query("SELECT * FROM members ORDER BY id");
    await assert.rejects(repo.importMembers([entry("Synthetic Rollback", "OM", "TEAM_2", 1), { ...entry("Synthetic Invalid", "OM", "TEAM_2", 2), role: "INVALID" as "OM" }], true), /TEAM_MEMBER_IMPORT_FAILED/);
    assert.deepEqual((await raw.query("SELECT * FROM members ORDER BY id")).rows, snapshot.rows);
  } finally {
    await disconnectPrismaClient(); await raw.end().catch(() => {}); for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
