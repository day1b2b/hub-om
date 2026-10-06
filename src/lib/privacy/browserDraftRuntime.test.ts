import test from "node:test";
import { deriveBrowserDraftKeyring } from "./browserDraftKeyring.server";
import assert from "node:assert/strict";
import { BrowserDraftRuntime, DraftLockedError, type DraftKeyringResponse } from "./browserDraftRuntime";
import { checkDraftSession } from "./draftSessionCheck";
import type { AccountDraftRecord, AccountDraftStore } from "./accountDraftStore";
import type { BrowserDraftScope } from "./browserDraftCrypto";

const subject = "google:synthetic-a", otherSubject = "google:synthetic-b";
const ring = (owner = "a", activeKeyId = "one"): DraftKeyringResponse => ({ version: 1, subject: owner === "a" ? subject : otherSubject, ownerId: "bdo1_" + owner.repeat(43), activeKeyId,
  keys: [{ keyId: "one", keyBase64: btoa(String.fromCharCode(...new Uint8Array(32).fill(owner === "a" ? 1 : 2))) }, { keyId: "two", keyBase64: btoa(String.fromCharCode(...new Uint8Array(32).fill(owner === "a" ? 3 : 4))) }] });
class MemoryStore implements AccountDraftStore {
  values = new Map<string, AccountDraftRecord>();
  fail = false;
  async read(scope: BrowserDraftScope) { return structuredClone(this.values.get(JSON.stringify(scope)) ?? null); }
  async write(scope: BrowserDraftScope, value: AccountDraftRecord, current: () => boolean) {
    if (this.fail || !current()) throw new Error("synthetic quota");
    this.values.set(JSON.stringify(scope), structuredClone(value));
  }
  async remove(scope: BrowserDraftScope, current: () => boolean) { if (!current()) throw new Error(); this.values.delete(JSON.stringify(scope)); }
}
function fixture() {
  const storage = new MemoryStore(); let owner = "a", active = "one", offline = false;
  const request = (async () => { if (offline) throw new TypeError("offline"); return Response.json(ring(owner, active)); }) as typeof fetch;
  return { storage, runtime: new BrowserDraftRuntime(storage, request), request, offline: () => { offline = true; }, online: () => { offline = false; }, owner: (next: string) => { owner = next; }, rotate: () => { active = "two"; } };
}
test("ready tab saves offline; restart is locked and online same-account recovery succeeds", async () => {
  const f = fixture(); await f.runtime.unlock(subject); const snapshot = f.runtime.getSnapshot();
  assert.equal(f.runtime.getSnapshot(), snapshot);
  f.offline(); await f.runtime.write("lecture-note", "op", { text: "synthetic private name" });
  assert.deepEqual(await f.runtime.read("lecture-note", "op"), { text: "synthetic private name" });
  assert.ok(!JSON.stringify([...f.storage.values]).includes("synthetic private name"));
  assert.ok(!JSON.stringify([...f.storage.values]).includes("keyBase64"));
  const restart = new BrowserDraftRuntime(f.storage, f.request);
  await assert.rejects(restart.read("lecture-note", "op"), DraftLockedError);
  await assert.rejects(restart.unlock(subject), DraftLockedError);
  f.online(); await restart.unlock(subject);
  assert.deepEqual(await restart.read("lecture-note", "op"), { text: "synthetic private name" });
});
test("another owner cannot read A and key rotation preserves old encrypted draft reads", async () => {
  const f = fixture(); await f.runtime.unlock(subject); await f.runtime.write("operation-submission", "team", { id: "stable", payloads: ["first", "second"] });
  f.runtime.lock(); f.owner("b"); await f.runtime.unlock(otherSubject);
  assert.equal(await f.runtime.read("operation-submission", "team"), null);
  f.runtime.lock(); f.owner("a"); f.rotate(); await f.runtime.unlock(subject);
  assert.deepEqual(await f.runtime.read("operation-submission", "team"), { id: "stable", payloads: ["first", "second"] });
  await f.runtime.write("operation-submission", "team", { id: "stable", payloads: ["first", "second"] });
  assert.equal([...f.storage.values.values()][0].keyId, "two");
});
test("lock during pending key response cannot revive a key or expose another identity", async () => {
  let resolve!: (response: Response) => void;
  const request = (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch;
  const runtime = new BrowserDraftRuntime(new MemoryStore(), request);
  const pending = runtime.unlock(subject); runtime.lock(); resolve(Response.json(ring()));
  await assert.rejects(pending, DraftLockedError); assert.equal(runtime.getSnapshot().status, "locked");
  const wrong = new BrowserDraftRuntime(new MemoryStore(), (async () => Response.json(ring("b"))) as typeof fetch);
  await assert.rejects(wrong.unlock(subject), DraftLockedError);
});
test("quota/tampering preserve existing storage and pending operation gets invalidated by logout", async () => {
  const f = fixture(); await f.runtime.unlock(subject); await f.runtime.write("issue-review", "op", { text: "first" });
  const before = JSON.stringify([...f.storage.values]); f.storage.fail = true;
  await assert.rejects(f.runtime.write("issue-review", "op", { text: "second" })); assert.equal(JSON.stringify([...f.storage.values]), before);
  f.storage.fail = false;
  const row = [...f.storage.values.values()][0]; row.keyId = "two";
  await assert.rejects(f.runtime.read("issue-review", "op"));
  const pending = f.runtime.write("drive-import", "op", { text: "late" }); f.runtime.lock();
  await assert.rejects(pending, DraftLockedError); assert.equal(f.storage.values.size, 1);
});
test("per-scope queue preserves caller order and caller mutations cannot alter the saved snapshot", async () => {
  const f = fixture(); await f.runtime.unlock(subject);
  const input = { text: "snapshot" }; const first = f.runtime.write("lecture-note", "op", input); input.text = "changed";
  await first; assert.deepEqual(await f.runtime.read("lecture-note", "op"), { text: "snapshot" });
  const second = f.runtime.write("lecture-note", "op", { text: "second" }); const deletion = f.runtime.remove("lecture-note", "op");
  await Promise.all([second, deletion]); assert.equal(await f.runtime.read("lecture-note", "op"), null);
});
test("session transport failure/503 are unavailable, whereas real 401 and another subject revoke identity", async () => {
  assert.equal(await checkDraftSession(subject, (async () => { throw new TypeError(); }) as typeof fetch), "unavailable");
  assert.equal(await checkDraftSession(subject, (async () => new Response(null, { status: 503 })) as typeof fetch), "unavailable");
  assert.equal(await checkDraftSession(subject, (async () => new Response(null, { status: 401 })) as typeof fetch), "denied");
  assert.equal(await checkDraftSession(subject, (async () => Response.json({ subject: otherSubject })) as typeof fetch), "changed");
  assert.equal(await checkDraftSession(subject, (async () => Response.json({ subject })) as typeof fetch), "same");
});

test("actual server-derived keyring contract imports and decrypts across rotation", async () => {
  const environment = { BROWSER_DRAFT_ACTIVE_KEY_ID: "old", BROWSER_DRAFT_MASTER_KEYS: JSON.stringify({ old: Buffer.alloc(32, 5).toString("base64"), next: Buffer.alloc(32, 6).toString("base64") }), BROWSER_DRAFT_OWNER_KEY: Buffer.alloc(32, 7).toString("base64") };
  const storage = new MemoryStore();
  const runtime = new BrowserDraftRuntime(storage, (async () => Response.json(deriveBrowserDraftKeyring(subject, environment))) as typeof fetch);
  await runtime.unlock(subject); await runtime.write("lecture-note", "synthetic-op", { note: "server contract" });
  runtime.lock(); environment.BROWSER_DRAFT_ACTIVE_KEY_ID = "next";
  await runtime.unlock(subject); assert.deepEqual(await runtime.read("lecture-note", "synthetic-op"), { note: "server contract" });
});
