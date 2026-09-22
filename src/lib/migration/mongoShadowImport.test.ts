import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { encodeMongoDocument, hashMongoDocument, mongoModelContracts, mongoModelNames, type CanonicalDocument } from "./mongoDocumentCodec";
import { shadowContentDigest, type ShadowDocument, type ShadowTarget } from "./mongoShadowTransfer";
import { importMongoShadowSpool, loadMongoShadowSpool, verifyMongoShadowRelations } from "./mongoShadowImport";
import type { ShadowExportManifest } from "./postgresShadowExport";

const uuid = "00000000-0000-4000-8000-000000000001";
function fixture(model: string, patch: Record<string, unknown> = {}) {
  const row = Object.fromEntries(Object.entries(mongoModelContracts[model].fields).map(([key, field]) => [key, field.nullable ? null : field.list ? [] : field.values?.[0] ?? (field.uuid ? uuid : ({ String: "synthetic", Int: 1, Boolean: true, DateTime: new Date("2026-09-22T00:00:00.000Z"), Decimal: "1.00" }[field.type]))]));
  return encodeMongoDocument(model, { ...row, ...patch }, { sourceMode: "plaintext" });
}
function memory(rows: Record<string, CanonicalDocument[]> = {}) {
  let inserts = 0;
  const data = new Map<string, ShadowDocument[]>();
  for (const [name, values] of Object.entries(rows)) data.set(name, structuredClone(values));
  const target: ShadowTarget = {
    databaseName: "hub_om_shadow_fixture",
    async insertOnly(_namespace, model, row) { inserts++; const values = data.get(model) ?? []; if (values.some(value => value._id === row._id)) return false; values.push(structuredClone(row)); data.set(model, values); return true; },
    async get(_namespace, model, id) { return structuredClone(data.get(model)?.find(row => row._id === id) ?? null); },
    async page(_namespace, model, after, limit) { return structuredClone((data.get(model) ?? []).filter(row => after === null || row._id > after).sort((a, b) => a._id < b._id ? -1 : 1).slice(0, limit)); },
    async count(_namespace, model) { return data.get(model)?.length ?? 0; },
  };
  return { target, inserts: () => inserts };
}
async function spool(run: (directory: string, manifest: ShadowExportManifest) => Promise<void>, rows: Record<string, CanonicalDocument[]> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hub-om-import-test-"));
  const manifest: ShadowExportManifest = { version: 1, snapshotId: "synthetic-snapshot", sourceConsistency: "exported-snapshot", sourceMode: "plaintext", sequenceHighWater: { "public.courses_process_seq": "7" }, sequenceValuesRequireFrozenRecheck: true, cutoverAuthorized: false, models: {} };
  try {
    for (const model of mongoModelNames) {
      const values = rows[model] ?? [];
      manifest.models[model] = { file: `${model}.jsonl`, count: values.length, digest: shadowContentDigest(values.map(row => ({ id: row._id, hash: hashMongoDocument(model, row) }))) };
      await writeFile(path.join(directory, `${model}.jsonl`), values.map(row => JSON.stringify(row) + "\n").join(""), { mode: 0o600 });
    }
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
    await run(directory, manifest);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("valid spool import preserves snapshot content and retries insert-only; never authorizes cutover", async () => {
  await spool(async directory => {
    const { target } = memory();
    const first = await importMongoShadowSpool(directory, "fixture", target, "production", true);
    const second = await importMongoShadowSpool(directory, "fixture", target, "production", true);
    assert.equal(first.cutoverAuthorized, false);
    assert.deepEqual(first, second);
    assert.equal(await target.count("shadow_fixture", "Company"), 1);
    const source = await loadMongoShadowSpool(directory);
    await assert.rejects(source.source.assertSnapshot("different"), /SPOOL_SNAPSHOT_MISMATCH/);
  }, { Company: [fixture("Company")] });
});

test("write gate and malformed manifest fail before any destination insert", async () => {
  await spool(async (directory, manifest) => {
    const target = memory();
    await assert.rejects(importMongoShadowSpool(directory, "fixture", target.target, "production", false), /SHADOW_WRITE_GATE/);
    for (const patch of [
      { sourceMode: "unknown" }, { sequenceValuesRequireFrozenRecheck: false }, { sequenceHighWater: null },
      { sequenceHighWater: { seq: "not-an-integer" } }, { unexpected: "arbitrary" }, { cutoverAuthorized: true },
    ]) {
      await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ ...manifest, ...patch }));
      await assert.rejects(importMongoShadowSpool(directory, "fixture", target.target, "production", true));
      assert.equal(target.inserts(), 0);
    }
  });
});

test("spool count/digest/truncation/order corruption is rejected", async () => {
  const company = fixture("Company");
  await spool(async (directory, manifest) => {
    const file = path.join(directory, "Company.jsonl");
    for (const body of [JSON.stringify(company), JSON.stringify(company) + "\n" + JSON.stringify(company) + "\n", JSON.stringify({ ...company, name: "changed" }) + "\n"]) {
      await writeFile(file, body);
      await assert.rejects(loadMongoShadowSpool(directory));
    }
    await writeFile(file, JSON.stringify(company) + "\n");
    manifest.models.Company.count++;
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(loadMongoShadowSpool(directory), /SPOOL_CONTENT_MISMATCH/);
  }, { Company: [company] });
});

test("manifest paths and final-component symlinks cannot redirect spool reads", async () => {
  await spool(async (directory, manifest) => {
    manifest.models.Company.file = "../outside.jsonl";
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(loadMongoShadowSpool(directory), /SPOOL_ENTRY/);
    manifest.models.Company.file = "Company.jsonl";
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    await rm(path.join(directory, "Company.jsonl"));
    await symlink(path.join(directory, "Course.jsonl"), path.join(directory, "Company.jsonl"));
    await assert.rejects(loadMongoShadowSpool(directory));
  });
});

test("independent target scan rejects orphan FK and duplicate logical unique keys", async () => {
  const company = fixture("Company");
  const course = fixture("Course");
  await assert.rejects(verifyMongoShadowRelations(memory({ Course: [course] }).target, "shadow_fixture"), /TARGET_FOREIGN_KEY_VIOLATION/);
  const other = fixture("Company", { id: "00000000-0000-4000-8000-000000000002" });
  await assert.rejects(verifyMongoShadowRelations(memory({ Company: [company, other] }).target, "shadow_fixture"), /TARGET_UNIQUE_VIOLATION/);
  const result = await verifyMongoShadowRelations(memory({ Company: [company], Course: [course] }).target, "shadow_fixture");
  assert.equal(result.verified, true);
  assert.match(result.evidenceId, /^[a-f0-9]{64}$/);
});


test("logical unique validation compares HMAC companions even when randomized ciphertext differs", async () => {
  const previous = { PII_ENCRYPTION_KEYS: process.env.PII_ENCRYPTION_KEYS, PII_ACTIVE_KEY_ID: process.env.PII_ACTIVE_KEY_ID, PII_INDEX_KEY: process.env.PII_INDEX_KEY };
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64") });
  try {
    const first = fixture("Member", { role: mongoModelContracts.Member.fields.role.values![0], sourceTeam: "TEAM_1" });
    const second = fixture("Member", { role: mongoModelContracts.Member.fields.role.values![0], sourceTeam: "TEAM_1", id: "00000000-0000-4000-8000-000000000002" });
    assert.notEqual(first.normalizedName, second.normalizedName);
    assert.equal(first.normalizedNamePiiIndex, second.normalizedNamePiiIndex);
    await assert.rejects(verifyMongoShadowRelations(memory({ Member: [first, second] }).target, "shadow_fixture"), /TARGET_UNIQUE_VIOLATION/);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
