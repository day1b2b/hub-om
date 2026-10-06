import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { deriveBrowserDraftKeyring, type BrowserDraftKeyringEnvironment } from "./browserDraftKeyring.server";
const fresh = () => randomBytes(32).toString("base64");
const master = fresh(), ownerKey = fresh();
const configuration = (): BrowserDraftKeyringEnvironment => ({
  BROWSER_DRAFT_MASTER_KEYS: JSON.stringify({ fixture1: master }), BROWSER_DRAFT_ACTIVE_KEY_ID: "fixture1", BROWSER_DRAFT_OWNER_KEY: ownerKey,
});
const subject = "google:synthetic-subject-a";
const failure = { message: "Browser draft key configuration is unavailable." };

test("authenticated subject deterministically derives opaque owner and a dedicated 256-bit key", () => {
  const env = configuration();
  const result = deriveBrowserDraftKeyring(subject, env);
  assert.deepEqual(deriveBrowserDraftKeyring(subject, env), result);
  assert.equal(result.version, 1);
  assert.equal(result.subject, subject);
  assert.match(result.ownerId, /^bdo1_[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(result.keys[0].keyBase64, "base64").length, 32);
  assert.notEqual(result.keys[0].keyBase64, master);
  assert.notEqual(result.keys[0].keyBase64, ownerKey);
  assert.ok(!JSON.stringify(result).includes(master));
  assert.ok(!JSON.stringify(result).includes(ownerKey));
});

test("different accounts and HKDF key IDs have separate key domains", () => {
  const a = deriveBrowserDraftKeyring(subject, configuration());
  const b = deriveBrowserDraftKeyring("google:synthetic-subject-b", configuration());
  assert.notEqual(a.ownerId, b.ownerId);
  assert.notEqual(a.keys[0].keyBase64, b.keys[0].keyBase64);
  const renamed = deriveBrowserDraftKeyring(subject, { ...configuration(), BROWSER_DRAFT_ACTIVE_KEY_ID: "renamed", BROWSER_DRAFT_MASTER_KEYS: JSON.stringify({ renamed: master }) });
  assert.equal(renamed.ownerId, a.ownerId);
  assert.notEqual(renamed.keys[0].keyBase64, a.keys[0].keyBase64);
});

test("master rotation preserves owner and retained old keys, without coupling auth secret rotation", () => {
  const env = configuration();
  const before = deriveBrowserDraftKeyring(subject, env);
  const after = deriveBrowserDraftKeyring(subject, { ...env, AUTH_SECRET: fresh(),
    BROWSER_DRAFT_ACTIVE_KEY_ID: "fixture2", BROWSER_DRAFT_MASTER_KEYS: JSON.stringify({ fixture2: fresh(), fixture1: master }) });
  assert.equal(after.ownerId, before.ownerId);
  assert.equal(after.keys.find(v => v.keyId === "fixture1")?.keyBase64, before.keys[0].keyBase64);
  assert.equal(after.activeKeyId, "fixture2");
  assert.equal(after.keys.length, 2);
});

test("missing, malformed, oversized or unsupported key configuration fails without revealing material", () => {
  for (const patch of [
    { BROWSER_DRAFT_MASTER_KEYS: "" }, { BROWSER_DRAFT_MASTER_KEYS: "{" }, { BROWSER_DRAFT_MASTER_KEYS: "[]" },
    { BROWSER_DRAFT_MASTER_KEYS: "{}" }, { BROWSER_DRAFT_MASTER_KEYS: "x".repeat(4097) },
    { BROWSER_DRAFT_MASTER_KEYS: JSON.stringify({ fixture1: "invalid" }) },
    { BROWSER_DRAFT_MASTER_KEYS: JSON.stringify(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`fixture${i}`, fresh()]))) },
    { BROWSER_DRAFT_ACTIVE_KEY_ID: "missing" }, { BROWSER_DRAFT_ACTIVE_KEY_ID: "bad:id" },
    { BROWSER_DRAFT_OWNER_KEY: "" }, { BROWSER_DRAFT_OWNER_KEY: randomBytes(16).toString("base64") },
    { PII_ENCRYPTION_KEYS: "{bad" },
  ]) assert.throws(() => deriveBrowserDraftKeyring(subject, { ...configuration(), ...patch }), failure);
});

test("master and owner keys cannot duplicate each other or any retained master", () => {
  assert.throws(() => deriveBrowserDraftKeyring(subject, { ...configuration(), BROWSER_DRAFT_OWNER_KEY: master }), failure);
  assert.throws(() => deriveBrowserDraftKeyring(subject, { ...configuration(), BROWSER_DRAFT_MASTER_KEYS: JSON.stringify({ fixture1: master, duplicate: master }) }), failure);
});

test("known authentication and PII key material cannot be reused, including base64url form", () => {
  for (const material of [master, ownerKey]) {
    for (const envName of ["AUTH_SECRET", "AUTH_SECRET_1", "NEXTAUTH_SECRET", "PII_INDEX_KEY"]) {
      assert.throws(() => deriveBrowserDraftKeyring(subject, { ...configuration(), [envName]: material }), failure);
      assert.throws(() => deriveBrowserDraftKeyring(subject, { ...configuration(), [envName]: Buffer.from(material, "base64").toString("base64url") }), failure);
    }
    assert.throws(() => deriveBrowserDraftKeyring(subject, { ...configuration(), PII_ENCRYPTION_KEYS: JSON.stringify({ retired: material }) }), failure);
  }
});

test("email, missing identity, non-Google identity and ambiguous subjects are refused", () => {
  for (const invalid of ["", "person@example.test", "google:", "other:subject", "google:bad\nsubject", "google:" + "a".repeat(256)]) {
    assert.throws(() => deriveBrowserDraftKeyring(invalid, configuration()), failure);
  }
});
