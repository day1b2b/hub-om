import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import { assertDraftEnvelope, assertVaultEnvelope, createVault, decryptDraft, encryptDraft, unlockVault } from "./browserDraftCrypto";

const secret = randomBytes(24).toString("base64");
const owner = "fixture-owner";
const scope = { owner, kind: "operation", operationId: "fixture-operation" };
const value = { note: "가상의 미저장 초안", nested: [true, null, 2], empty: "" };
const vault = await createVault(secret, owner);
const encrypted = await encryptDraft(vault.key, scope, value);
const mutate = (base64: string) => (base64[0] === "A" ? "B" : "A") + base64.slice(1);
const failure = { message: "Browser draft cryptography failed." };

test("serialized vault and draft survive a fresh unlock without serializing the secret or raw key", async () => {
  const saved = JSON.stringify({ vault: vault.envelope, draft: encrypted });
  assert.ok(!saved.includes(secret));
  assert.ok(!saved.includes(value.note));
  const reloaded = JSON.parse(saved);
  const fresh = await unlockVault(reloaded.vault, secret, owner);
  assert.notEqual(fresh, vault.key);
  assert.equal(fresh.extractable, false);
  assert.deepEqual(await decryptDraft(fresh, scope, reloaded.draft), value);
  assert.deepEqual(Object.keys(vault.envelope).sort(), ["algorithm", "iterations", "iv", "kdf", "salt", "version", "wrappedKey"]);
  assert.deepEqual(Object.keys(encrypted).sort(), ["algorithm", "ciphertext", "iv", "version"]);
});

test("created and unlocked data keys reject raw export", async () => {
  await assert.rejects(crypto.subtle.exportKey("raw", vault.key));
  const fresh = await unlockVault(vault.envelope, secret, owner);
  await assert.rejects(crypto.subtle.exportKey("raw", fresh));
});

test("same input uses a fresh nonce and different ciphertext each time", async () => {
  const other = await encryptDraft(vault.key, scope, value);
  assert.notEqual(other.iv, encrypted.iv);
  assert.notEqual(other.ciphertext, encrypted.ciphertext);
  assert.deepEqual(await decryptDraft(vault.key, scope, other), value);
});

test("wrong secret, owner and wrapped-key tampering fail closed", async () => {
  await assert.rejects(unlockVault(vault.envelope, `${secret}-wrong`, owner), failure);
  await assert.rejects(unlockVault(vault.envelope, secret, "another-owner"), failure);
  await assert.rejects(unlockVault({ ...vault.envelope, wrappedKey: mutate(vault.envelope.wrappedKey) }, secret, owner), failure);
});

test("authenticated vault salt, nonce and KDF iterations cannot be altered", async () => {
  for (const changed of [
    { salt: mutate(vault.envelope.salt) },
    { iv: mutate(vault.envelope.iv) },
    { iterations: vault.envelope.iterations - 1 },
  ]) await assert.rejects(unlockVault({ ...vault.envelope, ...changed }, secret, owner), failure);
});

test("other accounts, draft kinds and operation IDs cannot decrypt the draft", async () => {
  for (const changed of [{ owner: "other" }, { kind: "other" }, { operationId: "other" }]) {
    await assert.rejects(decryptDraft(vault.key, { ...scope, ...changed }, encrypted), failure);
  }
  await assert.rejects(decryptDraft(vault.key, { owner: "fixture", kind: "owner-operation", operationId: "fixture-operation" }, encrypted), failure);
});

test("draft ciphertext, nonce, metadata and unexpected plaintext fields fail closed", async () => {
  for (const changed of [
    { ciphertext: mutate(encrypted.ciphertext) }, { iv: mutate(encrypted.iv) },
    { version: 2 }, { algorithm: "AES-CBC" }, { plaintext: value },
  ]) await assert.rejects(decryptDraft(vault.key, scope, { ...encrypted, ...changed }), failure);
});

test("invalid vault metadata and hostile iteration counts are rejected before KDF", async () => {
  const derive = mock.method(crypto.subtle, "deriveKey");
  try {
    for (const changed of [
      { iterations: 99_999 }, { iterations: 1_000_001 }, { iterations: Infinity }, { iterations: 600_000.5 },
      { iterations: "600000" }, { version: 2 }, { kdf: "SHA1" }, { algorithm: "AES-CBC" },
      { salt: "a".repeat(4096) }, { iv: "invalid" }, { wrappedKey: "" }, { secret },
    ]) await assert.rejects(unlockVault({ ...vault.envelope, ...changed }, secret, owner), failure);
    assert.equal(derive.mock.callCount(), 0);
  } finally { derive.mock.restore(); }
});

test("envelope validation rejects malformed encoding and out-of-bounds ciphertext", () => {
  assertVaultEnvelope(vault.envelope);
  assertDraftEnvelope(encrypted);
  for (const ciphertext of ["====", "aa", "!".repeat(24), "A".repeat(12 * 1024 * 1024)]) {
    assert.throws(() => assertDraftEnvelope({ ...encrypted, ciphertext }));
  }
  assert.throws(() => assertVaultEnvelope(null));
  assert.throws(() => assertDraftEnvelope({ ...encrypted, extra: "value" }));
});

test("undefined or cyclic drafts, invalid scope and extractable keys are rejected", async () => {
  await assert.rejects(encryptDraft(vault.key, scope, undefined), failure);
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  await assert.rejects(encryptDraft(vault.key, scope, cycle), failure);
  await assert.rejects(encryptDraft(vault.key, { ...scope, owner: "" }, value), failure);
  const extractable = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await assert.rejects(encryptDraft(extractable, scope, value), failure);
});

test("independent vaults use random salts and data keys even with identical owner and secret", async () => {
  const other = await createVault(secret, owner);
  assert.notEqual(other.envelope.salt, vault.envelope.salt);
  assert.notEqual(other.envelope.wrappedKey, vault.envelope.wrappedKey);
  await assert.rejects(decryptDraft(other.key, scope, encrypted), failure);
});
