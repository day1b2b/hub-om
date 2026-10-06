import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { sealLegacyDraftQuarantine as seal, verifyLegacyDraftQuarantine as verify, recoverLegacyDraftQuarantine as recover } from "./legacyDraftQuarantine.server";
const key = randomBytes(32).toString("base64");
const env = { BROWSER_DRAFT_QUARANTINE_KEYS: JSON.stringify({ q1: key }), BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID: "q1" };
const snapshot = { version: 1 as const, source: "localStorage" as const, storageKey: "hub-om:operation-submission:v1:private@example.test:team", rawValue: '{broken JSON\u0000한국어😀\ud800', nonce: randomUUID() };
test("preserves malformed raw JSON, Unicode, raw key and source without exposing them", () => {
  const record = seal(snapshot, "google:a", env);
  assert.deepEqual(recover(record, env), snapshot);
  assert.deepEqual(verify(record, snapshot, "google:a", env), { verified: true, id: record.envelope.id, nonce: snapshot.nonce });
  for (const secret of [snapshot.storageKey, "private@example.test", "한국어", "google:a", key]) assert.equal(JSON.stringify(record).includes(secret), false);
  assert.notEqual(seal(snapshot, "google:a", env).envelope.ciphertext, record.envelope.ciphertext);
});
test("receipt binds snapshot, nonce, subject and every envelope field", () => {
  const record = seal(snapshot, "google:a", env);
  for (const patch of [{ rawValue: "other" }, { storageKey: snapshot.storageKey + "x" }, { source: "sessionStorage" }, { nonce: randomUUID() }]) assert.throws(() => verify(record, { ...snapshot, ...patch }, "google:a", env));
  assert.throws(() => verify(record, snapshot, "google:b", env));
  for (const field of ["iv", "tag", "ciphertext", "id", "keyId"] as const) {
    const changed = structuredClone(record); changed.envelope[field] = field === "id" ? randomUUID() : changed.envelope[field].replace(/^./, c => c === "A" ? "B" : "A");
    assert.throws(() => verify(changed, snapshot, "google:a", env));
  }
  assert.throws(() => verify({ ...record, receipt: "A".repeat(43) }, snapshot, "google:a", env));
});
test("rotation retains old recovery; missing or replaced old key fails closed", () => {
  const record = seal(snapshot, "google:a", env);
  const next = randomBytes(32).toString("base64");
  assert.deepEqual(recover(record, { ...env, BROWSER_DRAFT_QUARANTINE_KEYS: JSON.stringify({ q1: key, q2: next }), BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID: "q2" }), snapshot);
  assert.throws(() => recover(record, { ...env, BROWSER_DRAFT_QUARANTINE_KEYS: JSON.stringify({ q1: next }) }));
  assert.throws(() => recover(record, { ...env, BROWSER_DRAFT_QUARANTINE_KEYS: JSON.stringify({ q2: next }), BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID: "q2" }));
});
test("rejects reused auth, PII, owner and ordinary draft keys", () => {
  for (const name of ["AUTH_SECRET", "AUTH_SECRET_1", "NEXTAUTH_SECRET", "PII_INDEX_KEY", "BROWSER_DRAFT_OWNER_KEY", "BROWSER_DRAFT_MASTER_KEYS", "PII_ENCRYPTION_KEYS"]) {
    assert.throws(() => seal(snapshot, "google:a", { ...env, [name]: name.endsWith("KEYS") ? JSON.stringify({ other: key }) : key }));
  }
  assert.throws(() => seal(snapshot, "google:a", { ...env, BROWSER_DRAFT_QUARANTINE_KEYS: JSON.stringify({ q1: key, q2: key }) }));
});
test("validates scope, bounded exact schema and all four legacy prefixes in either storage", () => {
  for (const source of ["localStorage", "sessionStorage"]) for (const prefix of ["lecture-note-draft", "issue-review-draft", "drive-import-draft", "operation-submission:v1"]) assert.ok(seal({ ...snapshot, source, storageKey: `hub-om:${prefix}:synthetic` }, "google:a", env));
  for (const patch of [{ storageKey: "unrelated" }, { source: "cookie" }, { nonce: "bad" }, { extra: "bad" }, { rawValue: "x".repeat(8 * 1024 * 1024) }]) assert.throws(() => seal({ ...snapshot, ...patch }, "google:a", env));
});
