import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDraftEnvelope, assertVaultEnvelope, createVault, decryptDraft, encryptDraft,
  type BrowserDraftEnvelope, type BrowserDraftScope, type BrowserDraftVaultEnvelope
} from "./browserDraftCrypto";
import { IndexedDbDraftStore, migrateLegacyDraft, type BrowserDraftStore } from "./browserDraftStore";

const scope: BrowserDraftScope = { owner: "owner-fixture", kind: "lecture", operationId: "operation-fixture" };
const secret = "fixture passphrase only";
const vault = createVault(secret, scope.owner);
const data = { note: "synthetic private note", nested: [1, null, true] };
const source = JSON.stringify(data);
const id = (scope: BrowserDraftScope) => JSON.stringify([scope.owner, scope.kind, scope.operationId]);

class MemoryStore implements BrowserDraftStore {
  vaults = new Map<string, BrowserDraftVaultEnvelope>();
  drafts = new Map<string, BrowserDraftEnvelope>();
  recoveries = new Map<string, BrowserDraftEnvelope>();
  failWrite = false;
  reads = 0;
  onRead?: (count: number) => void;
  onCommit?: () => void;
  onRecoveryRead?: (count: number) => void;
  recoveryReads = 0;
  failRecovery = false;
  constructor(envelope?: BrowserDraftVaultEnvelope) {
    if (envelope) this.vaults.set(scope.owner, structuredClone(envelope));
  }
  async createVault(owner: string, envelope: unknown) {
    assertVaultEnvelope(envelope);
    if (this.vaults.has(owner)) throw new Error("Collision");
    this.vaults.set(owner, structuredClone(envelope));
  }
  async readVault(owner: string) { return structuredClone(this.vaults.get(owner)); }
  async writeDraft(scope: BrowserDraftScope, envelope: unknown, options: { ifAbsent?: boolean } = {}) {
    assertDraftEnvelope(envelope);
    if (this.failWrite) throw new Error("Quota or abort fixture");
    if (options.ifAbsent && this.drafts.has(id(scope))) throw new Error("Collision");
    this.drafts.set(id(scope), structuredClone(envelope));
    this.onCommit?.();
  }
  async readDraft(scope: BrowserDraftScope) {
    this.reads++;
    this.onRead?.(this.reads);
    return structuredClone(this.drafts.get(id(scope)));
  }
  async createRecovery(scope: BrowserDraftScope, envelope: unknown, expectedVault: unknown) {
    assertDraftEnvelope(envelope);
    assertVaultEnvelope(expectedVault);
    if (this.failRecovery || JSON.stringify(this.vaults.get(scope.owner)) !== JSON.stringify(expectedVault)) throw new Error("Recovery commit failed");
    const existing = this.recoveries.get(id(scope));
    if (existing && JSON.stringify(existing) !== JSON.stringify(envelope)) throw new Error("Recovery collision");
    if (!existing) this.recoveries.set(id(scope), structuredClone(envelope));
  }
  async readRecovery(scope: BrowserDraftScope) {
    this.recoveryReads++;
    this.onRecoveryRead?.(this.recoveryReads);
    return structuredClone(this.recoveries.get(id(scope)));
  }
}

function legacy(raw: string | null = source) {
  let value = raw;
  let removed = 0;
  let failRemove = false;
  return {
    getItem() { return value; },
    removeItem() { if (failRemove) throw new Error("Removal denied"); value = null; removed++; },
    replace(next: string | null) { value = next; },
    denyRemoval() { failRemove = true; },
    get removed() { return removed; }
  };
}

/** Minimal event fixture: requests succeed before transactions commit. No real IDB. */
function indexedDbFixture() {
  const records = new Map<string, Map<IDBValidKey, unknown>>();
  const pending: Array<() => void> = [];
  const events: string[] = [];
  const names: Array<[string, number | undefined]> = [];
  const durabilityOptions: Array<IDBTransactionOptions | undefined> = [];
  let pause = false;
  let strictSupported = true;
  let failure: "abort" | "quota" | undefined;
  type Handlers = { onsuccess?: () => void; onerror?: () => void; oncomplete?: () => void; onabort?: () => void; onupgradeneeded?: () => void };
  const database = {
    objectStoreNames: { contains: (name: string) => records.has(name) },
    createObjectStore(name: string) { records.set(name, new Map()); },
    close() {},
    transaction(names: string | string[], mode: IDBTransactionMode, options?: IDBTransactionOptions) {
      durabilityOptions.push(options);
      const stores = typeof names === "string" ? [names] : names;
      const staged = new Map(stores.map(name => [name, new Map(records.get(name)!)]));
      let active = true;
      let requests = 0;
      const tx: Handlers & { durability: string; objectStore: (name: string) => unknown; abort: () => void } = {
        durability: strictSupported ? options?.durability ?? "default" : "default",
        objectStore(name: string) {
          function run(operation: "get" | "add" | "put", value: unknown, key: IDBValidKey) {
            const request: Handlers & { result?: unknown } = {};
            requests++;
            queueMicrotask(() => {
              if (!active) return;
              const values = staged.get(name)!;
              if (failure === "quota" || (operation === "add" && values.has(key))) {
                failure = undefined; tx.abort(); return;
              }
              if (operation !== "get") values.set(key, structuredClone(value));
              request.result = operation === "get" ? structuredClone(values.get(key)) : key;
              events.push("request-success"); request.onsuccess?.();
              requests--;
              const finish = () => {
                if (!active || requests !== 0) return;
                if (failure === "abort") { failure = undefined; tx.abort(); return; }
                active = false;
                if (mode === "readwrite") for (const [name, values] of staged) records.set(name, values);
                events.push("complete"); tx.oncomplete?.();
              };
              if (pause) pending.push(finish); else queueMicrotask(finish);
            });
            return request;
          }
          return {
            get: (key: IDBValidKey) => run("get", undefined, key),
            add: (value: unknown, key: IDBValidKey) => run("add", value, key),
            put: (value: unknown, key: IDBValidKey) => run("put", value, key)
          };
        },
        abort() {
          if (!active) return;
          active = false;
          queueMicrotask(() => { events.push("abort"); tx.onabort?.(); });
        }
      };
      return tx;
    }
  };
  const factory = { open(name: string, version?: number) {
    names.push([name, version]);
    const request: Handlers & { result: unknown } = { result: database };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  } } as unknown as IDBFactory;
  return {
    factory, events, names, records, durabilityOptions,
    pause() { pause = true; },
    resume() { pause = false; pending.splice(0).forEach(fn => fn()); },
    fail(next: "abort" | "quota") { failure = next; },
    denyStrict() { strictSupported = false; }
  };
}

test("native adapter waits for transaction commit and preserves previous ciphertext after abort/quota", async () => {
  const { key } = await vault;
  const original = await encryptDraft(key, scope, data);
  const updated = await encryptDraft(key, scope, { note: "changed fixture" });
  const fixture = indexedDbFixture();
  const store = new IndexedDbDraftStore({ databaseName: "isolated-fixture-db", indexedDB: fixture.factory });
  await store.writeDraft(scope, original);
  fixture.pause();
  let resolved = false;
  const write = store.writeDraft(scope, updated).then(() => { resolved = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.events.at(-1), "request-success");
  assert.equal(resolved, false);
  fixture.fail("abort");
  fixture.resume();
  await assert.rejects(write, /storage failed/);
  assert.deepEqual(await store.readDraft(scope), original);
  fixture.fail("quota");
  await assert.rejects(store.writeDraft(scope, updated), /storage failed/);
  assert.deepEqual(await store.readDraft(scope), original);
  await store.writeDraft(scope, updated);
  assert.deepEqual(await store.readDraft(scope), updated);
  assert.deepEqual(fixture.names, [["isolated-fixture-db", 2]]);
  assert.ok(!JSON.stringify([...fixture.records.get("drafts")!.values()]).includes(data.note));
  store.close();
});

test("vault collisions and migration add collisions never overwrite existing envelopes", async () => {
  const { key, envelope } = await vault;
  const fixture = indexedDbFixture();
  const store = new IndexedDbDraftStore({ indexedDB: fixture.factory });
  await store.createVault(scope.owner, envelope);
  await assert.rejects(store.createVault(scope.owner, envelope), /storage failed/);
  assert.deepEqual(await store.readVault(scope.owner), envelope);
  const first = await encryptDraft(key, scope, data);
  await store.writeDraft(scope, first);
  await assert.rejects(store.writeDraft(scope, await encryptDraft(key, scope, {}), { ifAbsent: true }), /storage failed/);
  assert.deepEqual(await store.readDraft(scope), first);
  store.close();
});

test("public storage API rejects plaintext, extra properties, and unversioned envelopes before opening IDB", async () => {
  const { key, envelope } = await vault;
  const fixture = indexedDbFixture();
  const store = new IndexedDbDraftStore({ indexedDB: fixture.factory });
  const encrypted = await encryptDraft(key, scope, data);
  for (const value of [data, { ...encrypted, note: data.note }, { ...encrypted, version: 2 }, { ...encrypted, ciphertext: "plain text" }]) {
    await assert.rejects(store.writeDraft(scope, value));
  }
  await assert.rejects(store.createVault(scope.owner, { ...envelope, secret: "secret fixture" }));
  assert.equal(fixture.names.length, 0);
});

test("storage snapshots validated envelopes before asynchronous opening", async () => {
  const { key } = await vault;
  const fixture = indexedDbFixture();
  const store = new IndexedDbDraftStore({ indexedDB: fixture.factory });
  const envelope: BrowserDraftEnvelope & { note?: string } = await encryptDraft(key, scope, data);
  const original = structuredClone(envelope);
  const writing = store.writeDraft(scope, envelope);
  envelope.note = data.note;
  envelope.ciphertext = "changed after validation";
  await writing;
  assert.deepEqual(await store.readDraft(scope), original);
  assert.ok(!JSON.stringify([...fixture.records.get("drafts")!.values()]).includes(data.note));
  store.close();
});

test("legacy migration commits and decrypt-verifies before removal, with safe retry after interruption", async () => {
  const { key, envelope } = await vault;
  const store = new MemoryStore(envelope);
  const storage = legacy();
  store.onRecoveryRead = count => { if (count === 2) throw new Error("Interrupted after commit"); };
  const options = { store, storage, legacyKey: "legacy-fixture", scope, secret, confirmedOwner: scope.owner };
  await assert.rejects(migrateLegacyDraft(options), { code: "verification-failed" });
  assert.equal(storage.getItem(), source);
  assert.equal(storage.removed, 0);
  const committed = structuredClone(store.drafts.get(id(scope)));
  assert.deepEqual(await decryptDraft(key, scope, committed), data);
  store.onRecoveryRead = undefined;
  assert.deepEqual(await migrateLegacyDraft(options), { status: "migrated" });
  assert.deepEqual(store.drafts.get(id(scope)), committed);
  assert.equal(storage.getItem(), null);
  assert.equal(storage.removed, 1);
  assert.deepEqual(await migrateLegacyDraft(options), { status: "missing" });
});

test("unknown/mismatched legacy owner, invalid JSON and failed commit preserve the source", async () => {
  const { envelope } = await vault;
  for (const confirmedOwner of [undefined, "different-owner"]) {
    const store = new MemoryStore(envelope);
    const storage = legacy();
    await assert.rejects(migrateLegacyDraft({ store, storage, legacyKey: "legacy-fixture", scope, secret, confirmedOwner }), { code: "owner-unconfirmed" });
    assert.equal(storage.getItem(), source);
    assert.equal(store.drafts.size, 0);
    assert.equal(store.reads, 0);
  }
  const store = new MemoryStore(envelope);
  const storage = legacy();
  const options = { store, storage, legacyKey: "legacy-fixture", scope, secret, confirmedOwner: scope.owner };
  store.failWrite = true;
  await assert.rejects(migrateLegacyDraft(options));
  assert.equal(storage.getItem(), source);
  assert.equal(store.drafts.size, 0);
  storage.replace("invalid JSON");
  await assert.rejects(migrateLegacyDraft(options), { code: "invalid-json" });
  assert.equal(storage.getItem(), "invalid JSON");
  assert.equal(storage.removed, 0);
});

test("legacy migration refuses existing or concurrent destination collisions", async () => {
  const { key, envelope } = await vault;
  const other = await encryptDraft(key, scope, { note: "other existing draft" });
  for (const concurrent of [false, true]) {
    const store = new MemoryStore(envelope);
    const storage = legacy();
    if (concurrent) {
      // Return an empty first read, then add a competing draft before write.
      const read = store.readDraft.bind(store);
      store.readDraft = async requested => {
        const result = await read(requested);
        store.drafts.set(id(scope), other);
        return result;
      };
    } else store.drafts.set(id(scope), other);
    await assert.rejects(migrateLegacyDraft({ store, storage, legacyKey: "legacy-fixture", scope, secret, confirmedOwner: scope.owner }));
    assert.deepEqual(store.drafts.get(id(scope)), other);
    assert.equal(storage.getItem(), source);
    assert.equal(storage.removed, 0);
  }
});

test("source changes, invalid committed ciphertext and removal denial are incomplete and never delete the source", async () => {
  const { envelope } = await vault;
  for (const failure of ["source-changed", "verification-failed", "source-removal-failed"] as const) {
    const store = new MemoryStore(envelope);
    const storage = legacy();
    if (failure === "source-changed") store.onCommit = () => storage.replace("new concurrently edited source");
    if (failure === "verification-failed") store.onRecoveryRead = count => {
      if (count !== 2) return;
      const envelope = store.recoveries.get(id(scope))!;
      store.recoveries.set(id(scope), { ...envelope, ciphertext: "AAAA" });
    };
    if (failure === "source-removal-failed") storage.denyRemoval();
    await assert.rejects(migrateLegacyDraft({ store, storage, legacyKey: "legacy-fixture", scope, secret, confirmedOwner: scope.owner }), { code: failure });
    assert.equal(storage.getItem(), failure === "source-changed" ? "new concurrently edited source" : source);
    assert.equal(storage.removed, 0);
  }
});

test("migration requires a readable committed owner vault and correct secret", async () => {
  const { envelope } = await vault;
  for (const mode of ["missing", "wrong-secret", "wrong-owner", "storage-failure"] as const) {
    const store = new MemoryStore(mode === "missing" ? undefined : envelope);
    const storage = legacy();
    if (mode === "wrong-owner") store.vaults.set(scope.owner, (await createVault(secret, "other-owner")).envelope);
    if (mode === "storage-failure") store.readVault = async () => { throw new Error("Read denied"); };
    await assert.rejects(migrateLegacyDraft({ store, storage, legacyKey: "legacy-fixture", scope,
      secret: mode === "wrong-secret" ? "wrong fixture secret" : secret, confirmedOwner: scope.owner }), { code: "vault-unavailable" });
    assert.equal(storage.getItem(), source);
    assert.equal(storage.removed, 0);
    assert.equal(store.drafts.size, 0);
  }
});

test("immutable recovery and unchanged vault commit together with strict durability", async () => {
  const { key, envelope } = await vault;
  const fixture = indexedDbFixture();
  const store = new IndexedDbDraftStore({ indexedDB: fixture.factory });
  await store.createVault(scope.owner, envelope);
  const recovery = await encryptDraft(key, scope, data);
  const different = await encryptDraft(key, scope, { note: "different recovery" });
  fixture.fail("abort");
  await assert.rejects(store.createRecovery(scope, recovery, envelope));
  assert.equal(await store.readRecovery(scope), undefined);
  assert.deepEqual(await store.readVault(scope.owner), envelope);
  await store.createRecovery(scope, recovery, envelope);
  await store.createRecovery(scope, recovery, envelope);
  await assert.rejects(store.createRecovery(scope, different, envelope));
  const wrongVault = { ...envelope, iterations: envelope.iterations + 1 };
  await assert.rejects(store.createRecovery(scope, recovery, wrongVault));
  assert.deepEqual(await store.readRecovery(scope), recovery);
  assert.deepEqual(await store.readVault(scope.owner), envelope);
  assert.ok(fixture.durabilityOptions.filter(value => value !== undefined).every(value => value.durability === "strict"));
  store.close();
});

test("strict durability unsupported or failed recovery commit forbids legacy source removal", async () => {
  const { envelope } = await vault;
  const fixture = indexedDbFixture();
  const native = new IndexedDbDraftStore({ indexedDB: fixture.factory });
  await native.createVault(scope.owner, envelope);
  fixture.denyStrict();
  const memory = new MemoryStore(envelope);
  memory.failRecovery = true;
  for (const store of [native, memory]) {
    const storage = legacy();
    await assert.rejects(migrateLegacyDraft({ store, storage, legacyKey: "legacy-fixture", scope, secret, confirmedOwner: scope.owner }));
    assert.equal(storage.getItem(), source);
    assert.equal(storage.removed, 0);
    assert.equal(await store.readRecovery(scope), undefined);
  }
  native.close();
});

test("concurrent mutable draft overwrite after verification snapshot cannot erase migrated recovery", async () => {
  const { key, envelope } = await vault;
  const store = new MemoryStore(envelope);
  const storage = legacy();
  const newer = { note: "concurrent new encrypted draft" };
  const newerEnvelope = await encryptDraft(key, scope, newer);
  const readRecovery = store.readRecovery.bind(store);
  store.readRecovery = async requested => {
    const snapshot = await readRecovery(requested);
    if (store.recoveryReads === 2) await store.writeDraft(scope, newerEnvelope);
    return snapshot;
  };
  assert.deepEqual(await migrateLegacyDraft({ store, storage, legacyKey: "legacy-fixture", scope, secret, confirmedOwner: scope.owner }), { status: "migrated" });
  assert.equal(storage.getItem(), null);
  assert.deepEqual(await decryptDraft(key, scope, await store.readDraft(scope)), newer);
  assert.deepEqual(await decryptDraft(key, scope, await store.readRecovery(scope)), data);
});
