import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalJsonTeamMemberRepository } from "./localJsonTeamMemberRepository";
import { DEFAULT_RESOURCE_OWNER_ROSTER, DEFAULT_TEAM_MEMBER_ROLE_ROSTER } from "./defaultTeamMemberRoster";
import { encodePrivateJson } from "../privacy/crypto";

test("team-member local files decrypt and fail closed except when missing", async (t) => {
  const originalCwd = process.cwd();
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const directory = await mkdtemp(path.join(tmpdir(), "hub-om-team-members-test-"));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ test: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "test";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const payload = { members: [
    { name: " 가상 담당자 ", sourceTeam: "1팀" },
    { name: "가상 설계자", role: "LD", sourceTeam: "2팀" },
    { name: "가상 운영자", role: "om", sourceTeam: "1팀" }
  ] };
  try {
    await mkdir(path.join(directory, ".local"));
    process.chdir(directory);
    const file = path.join(directory, ".local", "team-members.json");
    const repository = new LocalJsonTeamMemberRepository();
    await t.test("missing files preserve default rosters", async () => {
      assert.deepEqual(await repository.listResourceOwners(), DEFAULT_RESOURCE_OWNER_ROSTER);
      assert.deepEqual(await repository.listRoleRosters(), DEFAULT_TEAM_MEMBER_ROLE_ROSTER);
      await assert.rejects(new LocalJsonTeamMemberRepository("../outside.json").listResourceOwners(), /must be inside/);
    });
    await t.test("encrypted payload restores owners and roles", async () => {
      await writeFile(file, `${encodePrivateJson(payload, "local:team-members")}\n`);
      assert.deepEqual(await repository.listResourceOwners(), { "1팀": ["가상 담당자"] });
      assert.deepEqual(await repository.listRoleRosters(), { ld: { "2팀": ["가상 설계자"] }, om: { "1팀": ["가상 운영자"] } });
    });
    await t.test("plaintext and malformed files do not fall back", async () => {
      for (const raw of [JSON.stringify(payload), "{invalid"]) {
        await writeFile(file, raw);
        await assert.rejects(repository.listResourceOwners(), /Unencrypted personal data/);
        await assert.rejects(repository.listRoleRosters(), /Unencrypted personal data/);
      }
    });
    await t.test("wrong context, corrupt ciphertext and missing key do not fall back", async () => {
      const encrypted = encodePrivateJson(payload, "local:team-members");
      for (const raw of [encodePrivateJson(payload, "local:team-users"), `${encrypted}!`]) {
        await writeFile(file, raw);
        await assert.rejects(repository.listRoleRosters(), /decryption failed/);
      }
      await writeFile(file, encrypted);
      const previous = process.env.PII_ENCRYPTION_KEYS;
      process.env.PII_ENCRYPTION_KEYS = "{}";
      try { await assert.rejects(repository.listResourceOwners(), /decryption failed/); }
      finally { process.env.PII_ENCRYPTION_KEYS = previous; }
    });
    await t.test("invalid decrypted payload and unreadable path do not fall back", async () => {
      for (const payload of [null, [], { members: "invalid" }]) {
        await writeFile(file, encodePrivateJson(payload, "local:team-members"));
        await assert.rejects(repository.listResourceOwners(), /Invalid local team-member data/);
      }
      await rm(file);
      await mkdir(file);
      await assert.rejects(repository.listResourceOwners());
    });
  } finally {
    process.chdir(originalCwd);
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
