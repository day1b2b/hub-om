import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftConflictError, IndexedDbAccountDraftStore, type AccountDraftRecord } from "./accountDraftStore";
const scope = { owner: "opaque-fixture-owner", kind: "operation", operationId: "fixture-operation" };
const record = (byte: number): AccountDraftRecord => ({ version: 2, keyId: "fixture", envelope: {
  version: 1, algorithm: "AES-GCM", iv: Buffer.alloc(12, byte).toString("base64"), ciphertext: Buffer.alloc(24, byte).toString("base64"),
} });
const first = record(1), second = record(2), third = record(3);
const key = JSON.stringify([scope.owner, scope.kind, scope.operationId]);
type Handlers = { onsuccess?: () => void; onerror?: () => void; onabort?: () => void; oncomplete?: () => void; onupgradeneeded?: () => void; result?: unknown };
type Operation = "get" | "put" | "delete";

/** Event fixture serializes transactions on the same store, like IDB's write
 * locks. Request success is distinct from commit, and aborted staged writes vanish.
 */
function fixture() {
  const persisted = new Map<string, AccountDraftRecord>();
  let tail = Promise.resolve();
  let quota = false, strict = true, throwStrict = false, pauseCommit = false;
  let successHook: ((operation: Operation, abort: () => void) => void) | undefined;
  const commits: Array<() => void> = [];
  const events: string[] = [];
  const transactions: Array<{ mode: IDBTransactionMode; durability?: IDBTransactionDurability; operations: Operation[] }> = [];
  const database = {
    createObjectStore() {}, close() {},
    transaction(_store: string, mode: IDBTransactionMode, options?: IDBTransactionOptions) {
      if (throwStrict && mode === "readwrite") throw new Error("Synthetic strict rejection");
      const log = { mode, durability: options?.durability, operations: [] as Operation[] };
      transactions.push(log);
      const requests: Array<{ operation: Operation; id: string; value?: AccountDraftRecord; request: Handlers }> = [];
      let aborted = false, finished = false;
      let staged: Map<string, AccountDraftRecord>;
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>(resolve => { release = resolve; });
      const tx: Handlers & { durability: string; abort: () => void; objectStore: () => unknown } = {
        durability: strict ? "strict" : "relaxed",
        abort() { aborted = true; },
        objectStore() {
          const enqueue = (operation: Operation, id: string, value?: AccountDraftRecord) => {
            const request: Handlers = {};
            log.operations.push(operation);
            requests.push({ operation, id, value: value === undefined ? undefined : structuredClone(value), request });
            return request;
          };
          return {
            get: (id: string) => enqueue("get", id),
            put: (value: AccountDraftRecord, id: string) => enqueue("put", id, value),
            delete: (id: string) => enqueue("delete", id),
          };
        },
      };
      function finish() {
        if (finished) return;
        finished = true;
        if (aborted) { events.push("abort"); tx.onabort?.(); }
        else {
          if (mode === "readwrite") { persisted.clear(); for (const [id, value] of staged) persisted.set(id, value); }
          events.push("complete"); tx.oncomplete?.();
        }
        release();
      }
      function pump() {
        if (aborted) { finish(); return; }
        const next = requests.shift();
        if (!next) {
          if (pauseCommit && mode === "readwrite") commits.push(finish); else queueMicrotask(finish);
          return;
        }
        const { operation, id, value, request } = next;
        if (operation !== "get" && quota) {
          quota = false; aborted = true; request.onerror?.(); tx.onerror?.(); queueMicrotask(pump); return;
        }
        if (operation === "put") staged.set(id, value!);
        if (operation === "delete") staged.delete(id);
        request.result = operation === "get" ? structuredClone(staged.get(id)) : undefined;
        events.push(`${operation}-success`);
        request.onsuccess?.();
        successHook?.(operation, () => tx.abort());
        queueMicrotask(pump);
      }
      void previous.then(() => { staged = new Map(persisted); pump(); });
      return tx;
    },
  };
  const factory = { open() {
    const request: Handlers = { result: database };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  } } as unknown as IDBFactory;
  return {
    store: new IndexedDbAccountDraftStore({ indexedDB: factory, databaseName: "synthetic-cas-fixture" }),
    persisted, events, transactions,
    quotaOnce() { quota = true; },
    rejectStrict(throwInstead = false) { strict = false; throwStrict = throwInstead; },
    afterSuccess(hook: typeof successHook) { successHook = hook; },
    pauseCommits() { pauseCommit = true; },
    resumeCommits() { pauseCommit = false; commits.splice(0).forEach(commit => commit()); },
  };
}

test("two concurrent missing-record CAS writers have exactly one winner", async () => {
  const f = fixture();
  const outcomes = await Promise.allSettled([f.store.write(scope, first, () => true, null), f.store.write(scope, second, () => true, null)]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof DraftConflictError);
  assert.equal(rejected.reason.name, "DraftConflictError");
  assert.deepEqual(await f.store.read(scope), first);
  assert.deepEqual(f.transactions.slice(0, 2).map(tx => tx.operations), [["get", "put"], ["get"]]);
  assert.ok(f.transactions.slice(0, 2).every(tx => tx.mode === "readwrite" && tx.durability === "strict"));
});

test("CAS compares the complete persisted record and stale overwrite/delete preserve a newer record", async () => {
  const f = fixture();
  await f.store.write(scope, first, () => true, null);
  const revision = JSON.stringify(await f.store.read(scope));
  await f.store.write(scope, second, () => true, revision);
  await assert.rejects(f.store.write(scope, third, () => true, revision), DraftConflictError);
  await assert.rejects(f.store.remove(scope, () => true, revision), DraftConflictError);
  await assert.rejects(f.store.write(scope, third, () => true, JSON.stringify(second.envelope)), DraftConflictError);
  assert.deepEqual(await f.store.read(scope), second);
  await f.store.remove(scope, () => true, JSON.stringify(second));
  assert.equal(await f.store.read(scope), null);
  await f.store.remove(scope, () => true, null);
});

test("undefined revision preserves legacy unconditional write/remove behavior", async () => {
  const f = fixture();
  await f.store.write(scope, first, () => true);
  await f.store.write(scope, second, () => true);
  assert.deepEqual(await f.store.read(scope), second);
  await f.store.remove(scope, () => true);
  assert.equal(await f.store.read(scope), null);
  assert.deepEqual(f.transactions.filter(tx => tx.mode === "readwrite").map(tx => tx.operations), [["put"], ["put"], ["delete"]]);
});

test("request success followed by transaction abort never replaces the existing record", async () => {
  const f = fixture();
  f.persisted.set(key, first);
  f.afterSuccess((operation, abort) => { if (operation === "put") abort(); });
  await assert.rejects(f.store.write(scope, second, () => true, JSON.stringify(first)), { message: "Encrypted draft storage did not commit." });
  assert.ok(f.events.includes("put-success"));
  assert.deepEqual(f.persisted.get(key), first);
});

test("a write resolves only after transaction completion, not request success", async () => {
  const f = fixture();
  f.pauseCommits();
  let settled = false;
  const pending = f.store.write(scope, first, () => true, null).then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.events.includes("put-success"));
  assert.equal(settled, false);
  assert.equal(f.persisted.size, 0);
  f.resumeCommits(); await pending;
  assert.equal(settled, true);
  assert.deepEqual(f.persisted.get(key), first);
});

test("quota and unsupported strict durability reject without overwriting", async () => {
  for (const mode of ["quota", "relaxed", "throw"] as const) {
    const f = fixture(); f.persisted.set(key, first);
    if (mode === "quota") f.quotaOnce(); else f.rejectStrict(mode === "throw");
    await assert.rejects(f.store.write(scope, second, () => true, JSON.stringify(first)));
    assert.deepEqual(f.persisted.get(key), first);
  }
});

test("current guard rejects stale identity before write and after the CAS read/mutation", async () => {
  for (const invalidateAt of ["before", "get", "put"] as const) {
    const f = fixture(); f.persisted.set(key, first);
    let checks = 0;
    // Checks: transaction setup, CAS read success, mutate, mutation success.
    const threshold = invalidateAt === "before" ? 0 : invalidateAt === "get" ? 1 : 3;
    await assert.rejects(f.store.write(scope, second, () => ++checks <= threshold, JSON.stringify(first)));
    assert.deepEqual(f.persisted.get(key), first);
  }
});

test("queued CAS snapshots input before opening the database", async () => {
  const f = fixture();
  const input = structuredClone(first);
  const pending = f.store.write(scope, input, () => true, null);
  input.keyId = "mutated";
  input.envelope.ciphertext = second.envelope.ciphertext;
  await pending;
  assert.deepEqual(await f.store.read(scope), first);
});

test("CAS removal also preserves the record on identity change, quota, or post-delete abort", async () => {
  for (const failure of ["identity", "quota", "abort"] as const) {
    const f = fixture(); f.persisted.set(key, first);
    let checks = 0;
    if (failure === "quota") f.quotaOnce();
    if (failure === "abort") f.afterSuccess((operation, abort) => { if (operation === "delete") abort(); });
    const current = () => failure !== "identity" || ++checks < 4;
    await assert.rejects(f.store.remove(scope, current, JSON.stringify(first)));
    assert.deepEqual(f.persisted.get(key), first);
  }
});
