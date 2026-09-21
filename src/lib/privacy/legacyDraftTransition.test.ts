import assert from "node:assert/strict";
import test from "node:test";
import { transitionLegacyDrafts, legacyQuarantineService, acknowledgeLegacyRegistration, withLegacyTransitionLock } from "./legacyDraftTransition";
import { LEGACY_REGISTRATION_UNRESOLVED, type LegacyStorageKind } from "./legacyDraftSources";
import type { LegacyDraftQuarantineRecord } from "./legacyDraftQuarantine";
import { sealLegacyDraftQuarantine, verifyLegacyDraftQuarantine, recoverLegacyDraftQuarantine } from "./legacyDraftQuarantine.server";
import { hasLegacyOperationSubmission } from "@/features/operations/operationSubmission";

const env = { BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID: "test", BROWSER_DRAFT_QUARANTINE_KEYS: JSON.stringify({ test: Buffer.alloc(32, 41).toString("base64") }) };
const localKey = "hub-om:lecture-note-draft:synthetic";
const sessionKey = "hub-om:operation-submission:v1:synthetic@example.invalid:team_1";
function fixture() {
  const values = { localStorage: new Map([[localKey, "local-private-marker"]]), sessionStorage: new Map([[sessionKey, "session-private-marker"]]) };
  const removed: string[] = [];
  let markerFails = false, removeFails = false, current = true, writeFails = false, readFails = false, verifyFails = false;
  let gate: Promise<void> | undefined;
  let onVerify: (() => void) | undefined;
  const stored = new Map<string, LegacyDraftQuarantineRecord>();
  const access = (kind: LegacyStorageKind) => ({
    get length() { return values[kind].size; }, key: (i: number) => [...values[kind].keys()][i] ?? null,
    getItem: (key: string) => values[kind].get(key) ?? null,
    setItem: (key: string, value: string) => { if (markerFails) throw new Error("quota"); values[kind].set(key, value); },
    removeItem: (key: string) => { if (removeFails) throw new Error("denied"); removed.push(key); values[kind].delete(key); },
  });
  const store = {
    async add(record: LegacyDraftQuarantineRecord) { await gate; if (writeFails) throw new Error("quota"); assert.equal(stored.has(record.envelope.id), false); stored.set(record.envelope.id, structuredClone(record)); },
    async read(id: string) { if (readFails) throw new Error("corrupt"); return stored.get(id) ?? null; },
    async count() { return stored.size; },
  };
  const service = {
    async seal(snapshot: Parameters<typeof sealLegacyDraftQuarantine>[0]) { return sealLegacyDraftQuarantine(snapshot, "google:synthetic", env); },
    async verify(record: LegacyDraftQuarantineRecord, snapshot: Parameters<typeof sealLegacyDraftQuarantine>[0]) {
      assert.deepEqual(stored.get(record.envelope.id), record);
      if (verifyFails) return false;
      verifyLegacyDraftQuarantine(record, snapshot, "google:synthetic", env); onVerify?.(); return true;
    },
  };
  return { values, removed, stored, access, store, service,
    options: () => ({ access, store, service, current: () => current, removeSession: true, removeLocal: false }),
    set: (option: { markerFails?: boolean; removeFails?: boolean; current?: boolean; writeFails?: boolean; readFails?: boolean; verifyFails?: boolean; gate?: Promise<void>; onVerify?: () => void }) => {
      markerFails = option.markerFails ?? markerFails; removeFails = option.removeFails ?? removeFails; current = option.current ?? current;
      writeFails = option.writeFails ?? writeFails; readFails = option.readFails ?? readFails; verifyFails = option.verifyFails ?? verifyFails;
      gate = option.gate ?? gate; onVerify = option.onVerify ?? onVerify;
    },
  };
}

test("strict commit/readback/server verification precede session deletion; local default is copy-only", async () => {
  const f = fixture(); let release!: () => void;
  f.set({ gate: new Promise<void>(r => { release = r; }) });
  const pending = transitionLegacyDrafts(f.options());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.removed.length, 0); assert.equal(f.stored.size, 0);
  release(); const result = await pending;
  assert.equal(result.copied, 2); assert.equal(result.removed, 1);
  assert.equal(f.values.localStorage.get(localKey), "local-private-marker");
  assert.equal(f.values.localStorage.get(LEGACY_REGISTRATION_UNRESOLVED), "1");
  assert.equal(hasLegacyOperationSubmission(f.access("localStorage")), true);
  const serialized = JSON.stringify([...f.stored]);
  assert.equal(serialized.includes("private-marker"), false); assert.equal(serialized.includes("example.invalid"), false);
  assert.equal([...f.stored.values()].some(v => recoverLegacyDraftQuarantine(v, env).storageKey === sessionKey), true);
});
test("local removal requires explicit mode and preserves immutable previous copies", async () => {
  const f = fixture(); await transitionLegacyDrafts(f.options());
  const old = [...f.stored.values()];
  const result = await transitionLegacyDrafts({ ...f.options(), removeLocal: true });
  assert.equal(result.removed, 1); assert.equal(f.values.localStorage.has(localKey), false);
  for (const record of old) assert.deepEqual(f.stored.get(record.envelope.id), record);
});
test("quota, readback failure, and verification rejection keep raw sources", async () => {
  for (const failure of ["writeFails", "readFails", "verifyFails"] as const) {
    const f = fixture(); f.set({ [failure]: true });
    const result = await transitionLegacyDrafts({ ...f.options(), removeLocal: true });
    assert.equal(f.removed.length, 0); assert.equal(result.failed, 2);
    assert.equal(f.values.sessionStorage.get(sessionKey), "session-private-marker");
    assert.equal(f.values.localStorage.get(localKey), "local-private-marker");
  }
});
test("marker failure prevents registration source removal", async () => {
  const f = fixture(); f.set({ markerFails: true });
  await transitionLegacyDrafts(f.options());
  assert.equal(f.values.sessionStorage.get(sessionKey), "session-private-marker");
  assert.equal(f.stored.size, 2);
});
test("source change preserves old encrypted copy and verifies the new value before removal", async () => {
  const f = fixture(); let changed = false;
  f.set({ onVerify: () => { if (!changed) { changed = true; f.values.sessionStorage.set(sessionKey, "new-private-marker"); } } });
  const result = await transitionLegacyDrafts(f.options());
  assert.equal(result.changed, 1); assert.equal(result.removed, 1); assert.equal(result.copied, 3);
  const raws = [...f.stored.values()].map(v => recoverLegacyDraftQuarantine(v, env).rawValue);
  assert.ok(raws.includes("session-private-marker")); assert.ok(raws.includes("new-private-marker"));
});
test("persistent writer changes exhaust bounded retries without removal or false completion", async () => {
  const f = fixture(); let index = 0;
  f.set({ onVerify: () => f.values.sessionStorage.set(sessionKey, `changing-${index++}`) });
  const result = await transitionLegacyDrafts(f.options());
  assert.equal(result.removed, 0); assert.equal(result.remaining.sessionStorage, 1); assert.ok(result.changed >= 2);
});
test("account/generation change stops all remaining work and retains raw", async () => {
  const f = fixture(); f.set({ onVerify: () => f.set({ current: false }) });
  const result = await transitionLegacyDrafts({ ...f.options(), removeLocal: true });
  assert.equal(f.stored.size, 1); assert.equal(f.removed.length, 0); assert.equal(result.failed, 1);
});
test("wire verification checks the saved record id and original nonce", async () => {
  const f = fixture(); const snapshot = { version: 1 as const, source: "localStorage" as const, storageKey: localKey, rawValue: "synthetic", nonce: crypto.randomUUID() };
  const record = await f.service.seal(snapshot);
  const api = legacyQuarantineService(async () => Response.json({ verified: true, id: record.envelope.id, nonce: "wrong" }));
  assert.equal(await api.verify(record, snapshot), false);
});
test("missing cooperative locks reject destructive actions", async () => {
  await assert.rejects(withLegacyTransitionLock(async () => {}, null), /잠금/);
});
test("fresh-start acknowledgement never clears pending raw, preserves ciphertext, and checks generation", async () => {
  const f = fixture();
  await assert.rejects(acknowledgeLegacyRegistration(f.access), /보호 절차/);
  await transitionLegacyDrafts(f.options());
  await assert.rejects(acknowledgeLegacyRegistration(f.access, () => false), /세션/);
  f.set({ removeFails: true }); await assert.rejects(acknowledgeLegacyRegistration(f.access));
  assert.equal(hasLegacyOperationSubmission(f.access("localStorage")), true);
  f.set({ removeFails: false }); await acknowledgeLegacyRegistration(f.access);
  assert.equal(hasLegacyOperationSubmission(f.access("localStorage")), false); assert.equal(f.stored.size, 2);
});
