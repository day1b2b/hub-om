/** Native lease와 명시 driver/clock fault. 실제 PG/API/Google oracle는 별도 suite 소유. */
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";
import { ClientSession, Collection, Long, MongoServerError, type CommandStartedEvent } from "mongodb";
import { activityContext } from "../activity/context";
import { CALENDAR_LEASE_TIMING, MongoCalendarOperationLock, prepareMongoCalendarLeaseStore } from "./mongoCalendarOperationLock";
import { arrived, attributed, barrier, bounded, CALENDAR_TEST_URI, calendarHarness, calendarOptIn, link, privateEvent, safeError, sleep, wire } from "./mongoCalendarIntegrationFixtures";

test("Calendar lease: native contention / default healthy renewal / labelled faults / owned process pause", { skip: !calendarOptIn, timeout: 600_000 }, async suite => {
  await calendarHarness(async h => {
    await suite.test("literal production timing wiring remains 60/15/5/180/10/1 seconds", () => {
      assert.deepEqual(CALENDAR_LEASE_TIMING, { leaseMs: 60_000, renewMs: 15_000, ioMs: 5_000, callbackMs: 180_000, transactionMs: 10_000, marginMs: 1_000 });
    });

    await suite.test("L1 native simultaneous first insert from distinct clients: one callback, exact duplicate, immediate busy", async () => {
      const f = await h.fixture(), second = await f.otherLock(), operationId = "synthetic-first-contention";
      const inserted = barrier(), callbackEntered = barrier(), release = barrier(), busy = barrier();
      const insert = Collection.prototype.insertOne; let attempts = 0, duplicate = 0, callbacks = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        if (this.collectionName !== f.lock.leases.collectionName) return insert.apply(this, args);
        if (++attempts === 2) inserted.resolve();
        await bounded(inserted.promise);
        try { return await insert.apply(this, args); }
        catch (error) {
          assert.ok(error instanceof MongoServerError); assert.equal(error.code, 11000);
          assert.deepEqual(error.keyPattern, { _id: 1 }); assert.deepEqual(error.keyValue, { _id: operationId }); duplicate++; throw error;
        }
      });
      const work = async () => { callbacks++; callbackEntered.resolve(); await bounded(release.promise); return "winner"; };
      const pending = [f.lock.withLock(operationId, work), second.withLock(operationId, work)];
      for (const promise of pending) void promise.catch(() => busy.resolve());
      try {
        await bounded(callbackEntered.promise); await bounded(busy.promise);
        assert.equal(callbacks, 1); assert.equal(attempts, 2); assert.equal(duplicate, 1);
        const held = await f.lock.leases.findOne({ _id: operationId }); assert.ok(held?.owner);
        assert.ok(Long.isLong(held.generation)); assert.equal(held.generation.toString(), "1");
        release.resolve();
        const outcomes = await Promise.allSettled(pending);
        assert.equal(outcomes.filter(value => value.status === "fulfilled").length, 1);
        const rejected = outcomes.find(value => value.status === "rejected"); assert.ok(rejected && rejected.status === "rejected"); safeError(rejected.reason);
        assert.equal((await f.lock.leases.findOne({ _id: operationId }))?.owner, null);
      } finally { inserted.resolve(); release.resolve(); await Promise.allSettled(pending); patch.mock.restore(); }
    });

    for (const conflict of ["wrong-key", "wrong-value", "missing-key"] as const) {
      await suite.test("L1 labelled unrelated insert duplicate is never treated as initial _id contention: " + conflict, async () => {
        const f = await h.fixture(); let callbacks = 0, attempts = 0;
        const original = Collection.prototype.insertOne;
        const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
          if (this.collectionName === f.lock.leases.collectionName) {
            attempts++; throw new MongoServerError({ code: 11000, message: privateEvent,
              ...(conflict === "missing-key" ? {} : { keyPattern: conflict === "wrong-key" ? { nonce: 1 } : { _id: 1 }, keyValue: { _id: "wrong" } }) });
          }
          return original.apply(this, args);
        });
        try { await assert.rejects(f.lock.withLock("synthetic-duplicate", async () => { callbacks++; }), safeError); }
        finally { patch.mock.restore(); }
        assert.equal(callbacks, 0); assert.equal(attempts, 1); assert.equal(await f.lock.leases.countDocuments(), 0);
      });
    }

    await suite.test("L2 same runtime/op reentry reuses handle; nested different operation/namespace/client refuses", async () => {
      const f = await h.fixture(), other = await h.fixture(), separateClient = await f.otherLock();
      await f.lock.withLock("synthetic-reentry", async handle => {
        const before = await f.lock.leases.findOne({ _id: "synthetic-reentry" });
        await f.lock.withLock("synthetic-reentry", async nested => {
          assert.equal(nested, handle); assert.equal(nested.signal, handle.signal);
          await nested.assertActive();
        });
        assert.deepEqual(await f.lock.leases.findOne({ _id: "synthetic-reentry" }), before);
        for (const [lock, id] of [[f.lock, "synthetic-different"], [other.lock, "synthetic-reentry"], [separateClient, "synthetic-reentry"]] as const) {
          let calls = 0; await assert.rejects(lock.withLock(id, async () => { calls++; }), /CALENDAR_SCOPE_MISMATCH/); assert.equal(calls, 0);
        }
      });
      const held = barrier(), release = barrier(); let calls = 0;
      const first = f.lock.withLock("synthetic-independent", async () => { calls++; held.resolve(); await bounded(release.promise); });
      try {
        await arrived(held, first);
        await Promise.all([other.lock.withLock("synthetic-independent", async () => { calls++; }), f.lock.withLock("synthetic-another", async () => { calls++; })]);
        assert.equal(calls, 3);
      } finally { release.resolve(); await first; }
    });

    await suite.test("L3-healthy/L12-healthy native 65s+ callback MUST succeed with >=2 renewals; mapping crosses 15s timer", { timeout: 90_000 }, async () => {
      const f = await h.fixture(), row = link("synthetic-healthy"), requestId = randomUUID();
      let renewals = 0, activeRenewals = 0, maxRenewals = 0, callbacks = 0;
      const original = Collection.prototype.updateOne, commit = ClientSession.prototype.commitTransaction, timeout = globalThis.setTimeout;
      const renewalDue = barrier();
      let scheduledAt: number | undefined, dueAt: number | undefined, guardAckAt: number | undefined, commitAckAt: number | undefined;
      let guardedSession: ClientSession | undefined, guardToCommit = false;
      const renewalWire: Array<{ at: number; guarded: boolean }> = [];
      // 최초 제품 renewal timer만 관찰한다. 실제 15초 timer/콜백을 그대로 실행하며 시간을 당기지 않는다.
      const timerPatch = mock.method(globalThis, "setTimeout", ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
        if (scheduledAt === undefined && delay === 15_000 && activityContext.getStore()?.requestId === requestId) {
          scheduledAt = performance.now();
          return timeout((...values: unknown[]) => {
            dueAt = performance.now();
            try { callback(...values); } finally { renewalDue.resolve(); }
          }, delay, ...args);
        }
        return timeout(callback, delay, ...args);
      }) as typeof setTimeout);
      const listener = (event: CommandStartedEvent) => {
        if (event.databaseName !== h.databaseName || event.commandName !== "update" || event.command.update !== f.lock.leases.collectionName) return;
        for (const command of event.command.updates ?? []) {
          const update = command.u;
          if (Array.isArray(update) && update[0]?.$set?.leaseUntil?.$dateAdd && update[0]?.$set?.owner === undefined) {
            renewalWire.push({ at: performance.now(), guarded: guardToCommit });
          }
        }
      };
      h.client.on("commandStarted", listener);
      const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const update = args[1];
        const isRenew = this.collectionName === f.lock.leases.collectionName && Array.isArray(update)
          && update[0]?.$set?.leaseUntil?.$dateAdd && update[0]?.$set?.owner === undefined;
        if (!isRenew) {
          const result = await original.apply(this, args);
          if (this.collectionName === f.lock.leases.collectionName && args[2]?.session && guardedSession === undefined) {
            assert.equal(result.matchedCount, 1); assert.equal(result.modifiedCount, 1);
            guardedSession = args[2].session; guardAckAt = performance.now(); guardToCommit = true;
          }
          return result;
        }
        activeRenewals++; maxRenewals = Math.max(maxRenewals, activeRenewals);
        try { const value = await original.apply(this, args); assert.equal(value.matchedCount, 1); renewals++; return value; }
        finally { activeRenewals--; }
      });
      const commitPatch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
        const result = await commit.apply(this, args);
        if (this === guardedSession && commitAckAt === undefined) { commitAckAt = performance.now(); guardToCommit = false; }
        return result;
      });
      const start = performance.now();
      try {
        const result = await attributed(() => f.lock.withLock(row.operationId, async handle => {
          callbacks++;
          const initial = await f.lock.leases.findOne({ _id: row.operationId }); assert.ok(initial?.owner);
          assert.notEqual(scheduledAt, undefined);
          await sleep(Math.max(0, scheduledAt! + 13_500 - performance.now()));
          // 실제 DB guard를 잡은 상태로 renewal tick을 넘는다. transaction 예산 10초 이내.
          await f.lock.mapping(row.operationId, async session => {
            assert.equal(session.inTransaction(), true); assert.equal(session, guardedSession);
            assert.equal(guardToCommit, true); assert.equal(dueAt, undefined, "guard ACK가 실제 renewal 발화보다 먼저여야 한다");
            await bounded(renewalDue.promise, 5_000);
            assert.notEqual(dueAt, undefined); assert.ok(dueAt! >= scheduledAt! + 14_900);
            assert.ok(guardAckAt! < dueAt!, "실제 renewal timer가 transaction 구간 안에서 발화했음을 확인");
            // mutex가 없으면 여기서 DB update가 전송된 뒤 native guard에서 대기할 수 있다. 성공만으로 판정하지 않는다.
            await sleep(150);
            assert.equal(renewalWire.filter(event => event.guarded).length, 0);
          });
          assert.notEqual(commitAckAt, undefined); assert.ok(dueAt! < commitAckAt!);
          assert.equal(renewalWire.filter(event => event.guarded).length, 0, "guard ACK부터 commit ACK까지 renewal wire issuance 0");
          await f.repo.saveCalendarEventLink(row);
          await sleep(Math.max(0, 65_200 - (performance.now() - start)));
          await handle.assertActive(); assert.equal(handle.signal.aborted, false);
          const renewed = await f.lock.leases.findOne({ _id: row.operationId }); assert.ok(renewed);
          assert.equal(renewed.owner, initial.owner); assert.ok(renewed.generation.equals(initial.generation));
          assert.ok(renewed.leaseUntil.getTime() > initial.leaseUntil.getTime());
          return "healthy-success";
        }), requestId);
        assert.equal(result, "healthy-success"); assert.ok(performance.now() - start >= 65_000);
        assert.ok(renewals >= 2); assert.equal(maxRenewals, 1); assert.equal(activeRenewals, 0); assert.equal(callbacks, 1);
        assert.ok(renewalWire.length >= 2); assert.equal(renewalWire.filter(event => event.guarded).length, 0);
        assert.ok(renewalWire[0].at >= commitAckAt!, "실제로 발화한 갱신은 transaction commit ACK 이후에 전송되어야 한다");
        assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [row]);
        assert.equal((await f.lock.leases.findOne({ _id: row.operationId }))?.owner, null);
      } finally {
        commitPatch.mock.restore(); patch.mock.restore(); timerPatch.mock.restore(); h.client.off("commandStarted", listener);
      }
    });

    await suite.test("L3-clock wall-clock jumps do not redefine authoritative server lease", async () => {
      const f = await h.fixture(), now = Date.now; let shift = 0;
      const clock = mock.method(Date, "now", () => now() + shift);
      try {
        await f.lock.withLock("synthetic-wall-clock", async handle => {
          for (const delta of [86_400_000, -86_400_000, 0]) { shift = delta; await handle.assertActive(); assert.equal(handle.signal.aborted, false); }
          const hello = await f.store.db.command({ hello: 1 });
          const row = await f.lock.leases.findOne({ _id: "synthetic-wall-clock" }); assert.ok(row);
          const remaining = row.leaseUntil.getTime() - (hello.localTime as Date).getTime();
          assert.ok(remaining > 45_000 && remaining <= 60_000);
        });
      } finally { clock.mock.restore(); }
    });

    await suite.test("L5 BSON Long beyond 2^53 increments exactly, retains generation, rejects overflow", async () => {
      const f = await h.fixture(), operationId = "synthetic-long";
      const initial = Long.fromString("9007199254740993");
      await f.lock.leases.insertOne({ _id: operationId, owner: null, generation: initial, nonce: randomUUID(), leaseUntil: new Date(0) });
      for (const expected of ["9007199254740994", "9007199254740995"]) {
        await f.lock.withLock(operationId, async () => {
          const row = await f.lock.leases.findOne({ _id: operationId }); assert.ok(row);
          assert.ok(Long.isLong(row.generation)); assert.equal(row.generation.toString(), expected);
        });
        const row = await f.lock.leases.findOne({ _id: operationId }); assert.ok(row);
        assert.equal(row.owner, null); assert.equal(row.generation.toString(), expected);
      }
      await f.lock.leases.updateOne({ _id: operationId }, { $set: { generation: Long.MAX_VALUE } });
      const before = await f.lock.leases.findOne({ _id: operationId }); let callbacks = 0;
      await assert.rejects(f.lock.withLock(operationId, async () => { callbacks++; }), safeError);
      assert.equal(callbacks, 0); assert.deepEqual(await f.lock.leases.findOne({ _id: operationId }), before);
      const indexes = await f.lock.leases.listIndexes().toArray(); assert.equal(indexes.length, 1);
      assert.equal(indexes[0].expireAfterSeconds, undefined); assert.equal(await f.lock.leases.countDocuments(), 1);
      for (const invalid of [Long.fromInt(-1), 1]) {
        await assert.rejects(f.lock.leases.updateOne({ _id: operationId }, { $set: { generation: invalid as Long } }), error => {
          assert.ok(error instanceof MongoServerError); assert.equal(error.code, 121); return true;
        });
      }
    });

    for (const damage of ["validator", "invalid-document", "ttl", "extra-index", "capped", "collation"] as const) {
      await suite.test("M1 lease metadata mismatch refused by open and prepare, no reset: " + damage, async () => {
        const f = await h.fixture();
        await f.lock.withLock("synthetic-existing", async () => {});
        if (damage === "validator") await f.store.db.command({ collMod: f.lock.leases.collectionName, validator: {}, validationLevel: "off" });
        if (damage === "invalid-document") await f.lock.leases.updateOne({ _id: "synthetic-existing" }, { $set: { generation: Long.fromInt(-1) } }, { bypassDocumentValidation: true });
        if (damage === "ttl") {
          await f.lock.leases.updateOne({ _id: "synthetic-existing" }, { $set: { leaseUntil: new Date("2199-01-01") } });
          await f.lock.leases.createIndex({ leaseUntil: 1 }, { expireAfterSeconds: 0 });
        }
        if (damage === "extra-index") await f.lock.leases.createIndex({ nonce: 1 });
        if (damage === "capped" || damage === "collation") {
          const info = await f.store.db.listCollections({ name: f.lock.leases.collectionName }, { nameOnly: false }).next(); assert.ok(info);
          const rows = await f.lock.leases.find({}).toArray(); await f.lock.leases.drop();
          await f.store.db.createCollection(f.lock.leases.collectionName, { ...info.options,
            ...(damage === "capped" ? { capped: true, size: 1024 * 1024 } : { collation: { locale: "en", strength: 2 } }) });
          await f.lock.leases.insertMany(rows);
        }
        const metadata = await f.metadata(), rows = await f.lock.leases.find({}).toArray();
        await assert.rejects(MongoCalendarOperationLock.open(f.options), safeError);
        await assert.rejects(prepareMongoCalendarLeaseStore(f.options), safeError);
        assert.deepEqual(await f.metadata(), metadata); assert.deepEqual(await f.lock.leases.find({}).toArray(), rows);
      });
    }

    await suite.test("M1 explicit prepare/open preserve an active owner/generation and enforce shadow gates", async () => {
      const f = await h.fixture();
      await f.lock.withLock("synthetic-prepared-owner", async () => {
        const before = await f.lock.leases.findOne({ _id: "synthetic-prepared-owner" }); assert.ok(before?.owner);
        await prepareMongoCalendarLeaseStore(f.options); await MongoCalendarOperationLock.open(f.options);
        assert.deepEqual(await f.lock.leases.findOne({ _id: "synthetic-prepared-owner" }), before);
      });
      for (const options of [{ ...f.options, allowShadowWrites: false }, { ...f.options, databaseName: "production" }, { ...f.options, namespace: "production" }]) {
        await assert.rejects(prepareMongoCalendarLeaseStore(options as typeof f.options), safeError);
        await assert.rejects(MongoCalendarOperationLock.open(options as typeof f.options), safeError);
      }
    });

    for (const fault of ["renew-io-before", "renew-ack-after", "renew-owner-mismatch", "late-renew-ack", "deadline"] as const) {
      await suite.test("L4/L7 labelled fault/monotonic shift never resurrects or reruns callback: " + fault, async () => {
        const f = await h.fixture(), operationId = "synthetic-loss", original = Collection.prototype.updateOne, now = performance.now.bind(performance);
        let offset = 0, renewals = 0, callbacks = 0, mappingCalls = 0;
        const clock = mock.method(performance, "now", () => now() + offset);
        const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const update = args[1];
          const renewing = this.collectionName === f.lock.leases.collectionName && Array.isArray(update) && update[0]?.$set?.leaseUntil?.$dateAdd && !update[0]?.$set?.owner;
          if (!renewing) return original.apply(this, args);
          renewals++;
          if (fault === "renew-io-before") throw new Error(privateEvent);
          const value = await original.apply(this, args);
          if (fault === "renew-ack-after") throw new Error(privateEvent);
          if (fault === "late-renew-ack") offset = 61_000;
          return value;
        });
        try {
          await assert.rejects(f.lock.withLock(operationId, async handle => {
            callbacks++;
            if (fault === "renew-owner-mismatch") await f.forceOwner(operationId);
            offset = fault === "deadline" ? 180_001 : 44_500; // mapping reserve 경계의 동기 renewal을 유도하는 clock fault.
            await assert.rejects(f.lock.mapping(operationId, async () => { mappingCalls++; }), safeError);
            assert.equal(handle.signal.aborted, true);
            offset = 0; // 시계가 돌아와도 LOST는 terminal.
            await assert.rejects(handle.assertActive(), safeError);
            await assert.rejects(f.lock.withLock(operationId, async () => { callbacks++; }), safeError);
          }), safeError);
        } finally { patch.mock.restore(); clock.mock.restore(); }
        assert.equal(callbacks, 1); assert.equal(mappingCalls, 0); assert.equal(renewals, fault === "deadline" ? 0 : 1);
      });
    }

    await suite.test("L7 final check can reject after earlier mapping commit; callback failure is not rollback", async () => {
      const f = await h.fixture(), row = link("synthetic-final-loss"); let callbacks = 0;
      await assert.rejects(attributed(() => f.lock.withLock(row.operationId, async () => {
        callbacks++; await f.repo.saveCalendarEventLink(row); await f.forceOwner(row.operationId);
      })), safeError);
      assert.equal(callbacks, 1); assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [row]);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
    });

    await suite.test("L2/L7 labelled monotonic progression: successful renewals/reentry never reset the 180s callback deadline", async () => {
      const f = await h.fixture(), operationId = "synthetic-total-deadline", now = performance.now.bind(performance);
      let offset = 0, callbacks = 0, mappings = 0;
      const clock = mock.method(performance, "now", () => now() + offset);
      try {
        await assert.rejects(f.lock.withLock(operationId, async handle => {
          callbacks++;
          for (const step of [45_000, 90_000, 135_000]) {
            offset = step;
            await f.lock.mapping(operationId, async () => { mappings++; });
            assert.equal(handle.signal.aborted, false);
          }
          offset = 170_000;
          await f.lock.withLock(operationId, async same => { assert.equal(same, handle); });
          // 마지막 renewal의 보수적 lease는 약194초까지다. 180초 실패는 전체 callback 기한이어야 한다.
          offset = 180_001;
          await assert.rejects(handle.assertActive(), safeError); assert.equal(handle.signal.aborted, true);
          offset = 0;
        }), safeError);
      } finally { clock.mock.restore(); }
      assert.equal(callbacks, 1); assert.equal(mappings, 3);
    });

    await suite.test("L9 acquisition native update committed but ACK lost => callback 0, no implicit reacquire", async () => {
      const f = await h.fixture(), operationId = "synthetic-acquire-ack";
      const original = Collection.prototype.findOneAndUpdate; let calls = 0, callbacks = 0;
      const patch = mock.method(Collection.prototype, "findOneAndUpdate", async function (this: Collection, ...args: Parameters<Collection["findOneAndUpdate"]>) {
        const value = await original.apply(this, args);
        if (this.collectionName === f.lock.leases.collectionName) { calls++; throw new Error(privateEvent); }
        return value;
      });
      try { await assert.rejects(f.lock.withLock(operationId, async () => { callbacks++; }), safeError); }
      finally { patch.mock.restore(); }
      assert.equal(calls, 1); assert.equal(callbacks, 0);
      const residual = await f.lock.leases.findOne({ _id: operationId }); assert.ok(residual?.owner);
      assert.equal(residual.generation.toString(), "1");
      await assert.rejects(f.lock.withLock(operationId, async () => { callbacks++; }), safeError); assert.equal(callbacks, 0);
      assert.deepEqual(await f.repo.listAllCalendarEventLinks(), []);
    });

    for (const afterApply of [false, true]) {
      await suite.test("L10 native release " + (afterApply ? "ACK loss" : "before-write fault") + " preserves successful result and safe logging", async () => {
        const f = await h.fixture(), operationId = "synthetic-release";
        const update = Collection.prototype.updateOne; let releases = 0;
        const logs: unknown[][] = [];
        const log = mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
        const patch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
          const isRelease = this.collectionName === f.lock.leases.collectionName && Array.isArray(args[1]) && args[1][0]?.$set?.owner === null;
          if (!isRelease) return update.apply(this, args);
          releases++; if (afterApply) await update.apply(this, args); throw new Error(privateEvent);
        });
        try { assert.equal(await f.lock.withLock(operationId, async () => "committed-success"), "committed-success"); }
        finally { patch.mock.restore(); log.mock.restore(); }
        assert.equal(releases, 1); assert.deepEqual(logs, [["[gcal] CALENDAR_LEASE_RELEASE_FAILED"]]);
        const row = await f.lock.leases.findOne({ _id: operationId }); assert.ok(row);
        if (afterApply) assert.equal(row.owner, null); else assert.equal(typeof row.owner, "string");
      });
    }

    await suite.test("L5/L10 forced owner native write: stale release cannot clear successor", async () => {
      const f = await h.fixture(), operationId = "synthetic-successor"; let successor: Awaited<ReturnType<typeof f.forceOwner>> | undefined;
      await assert.rejects(f.lock.withLock(operationId, async handle => {
        successor = await f.forceOwner(operationId); await assert.rejects(handle.assertActive(), safeError);
      }), safeError);
      assert.ok(successor); assert.deepEqual(await f.lock.leases.findOne({ _id: operationId }), successor);
    });

    await suite.test("L6a native guard transaction blocks forced owner write until commit (NOT natural expiry)", async () => {
      const f = await h.fixture(), row = link("synthetic-guard"), second = await f.otherLock(), requestId = randomUUID();
      const held = barrier(), releaseCommit = barrier(), successorDone = barrier(), successorStarted = barrier();
      const commit = ClientSession.prototype.commitTransaction, update = Collection.prototype.updateOne;
      let callbacks = 0, mappingReturned = false, attempts = 0, bSettled = false;
      let beforeNonce: string | undefined, guardNonce: string | undefined, guardSession: ClientSession | undefined, guardWrites = 0;
      const guardPatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        const result = await update.apply(this, args);
        if (this.collectionName === f.lock.leases.collectionName && args[2]?.session) {
          assert.equal(result.matchedCount, 1); assert.equal(result.modifiedCount, 1);
          assert.equal(typeof args[0].owner, "string"); assert.ok(Long.isLong(args[0].generation)); assert.ok(args[0].$expr);
          assert.ok(!Array.isArray(args[1])); const fields = args[1].$set; assert.ok(fields); assert.equal(typeof fields.nonce, "string");
          guardNonce = fields.nonce; guardSession = args[2].session; guardWrites++;
        }
        return result;
      });
      const patch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
        if (activityContext.getStore()?.requestId !== requestId) return commit.apply(this, args);
        attempts++;
        assert.equal(guardWrites, 1); assert.equal(this, guardSession); assert.equal(typeof beforeNonce, "string");
        const guarded = await f.lock.leases.findOne({ _id: row.operationId }, { session: this }); assert.ok(guarded);
        assert.notEqual(guarded.nonce, beforeNonce, "동일 transaction에서 mapping 이전과 다른 nonce가 보여야 한다");
        assert.equal(guarded.nonce, guardNonce, "modifiedCount 1로 ACK된 조건부 guard의 nonce와 일치");
        const staged = await f.store.collection("CalendarEventLink").countDocuments({}, { session: this });
        assert.equal(staged, 1); held.resolve(); await bounded(releaseCommit.promise);
        const result = await commit.apply(this, args); await bounded(successorDone.promise); return result;
      });
      const monitor = wire(second.client, h.databaseName);
      const listener = (event: CommandStartedEvent) => {
        if (event.databaseName === h.databaseName && event.commandName === "update" && event.command.update === second.leases.collectionName) successorStarted.resolve();
      };
      second.client.on("commandStarted", listener);
      const a = attributed(() => f.lock.withLock(row.operationId, async () => {
        callbacks++;
        const before = await f.lock.leases.findOne({ _id: row.operationId }); assert.ok(before); beforeNonce = before.nonce;
        await f.repo.saveCalendarEventLink(row); mappingReturned = true;
      }), requestId);
      void a.catch(() => {});
      let b: Promise<unknown> | undefined;
      try {
        await arrived(held, a);
        assert.equal(await f.store.collection("CalendarEventLink").countDocuments(), 0, "commit 전 mapping은 외부에서 보이지 않는다");
        b = second.leases.updateOne({ _id: row.operationId }, { $set: { owner: "synthetic-forced-b", nonce: randomUUID() }, $inc: { generation: Long.ONE } },
          { timeoutMS: 5_000, writeConcern: { w: "majority", j: true } }).then(result => {
          bSettled = true; assert.equal(result.modifiedCount, 1); successorDone.resolve(); return result;
        });
        void b.catch(() => { bSettled = true; successorDone.resolve(); });
        await bounded(successorStarted.promise); await sleep(150);
        assert.equal(bSettled, false, "native nonce guard 쓰기와 같은 lease 문서에서 경합");
        releaseCommit.resolve(); await b; await assert.rejects(a, safeError);
        assert.equal(callbacks, 1); assert.equal(attempts, 1); assert.equal(guardWrites, 1); assert.equal(mappingReturned, true);
        assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [row]); assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
        assert.equal((await second.leases.findOne({ _id: row.operationId }))?.owner, "synthetic-forced-b");
        assert.ok(monitor.commands.some(event => event.commandName === "update"));
      } finally {
        releaseCommit.resolve(); successorDone.resolve(); await Promise.allSettled(b ? [a, b] : [a]);
        patch.mock.restore(); guardPatch.mock.restore(); monitor.stop(); second.client.off("commandStarted", listener);
      }
    });

    await suite.test("L11a labelled transient DB callback retry rechecks guard AFTER native abort + forced owner change", async () => {
      const f = await h.fixture(), row = link("synthetic-transient"), requestId = randomUUID();
      const insert = Collection.prototype.insertOne, abort = ClientSession.prototype.abortTransaction, update = Collection.prototype.updateOne;
      let callbacks = 0, mappingInserts = 0, guards = 0, aborted = 0;
      const insertPatch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        if (this.collectionName === f.store.collection("CalendarEventLink").collectionName) mappingInserts++;
        const result = await insert.apply(this, args);
        if (this.collectionName === f.store.collection("ActivityChange").collectionName) {
          const error = new MongoServerError({ code: 112, message: privateEvent }); error.addErrorLabel("TransientTransactionError"); throw error;
        }
        return result;
      });
      const abortPatch = mock.method(ClientSession.prototype, "abortTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["abortTransaction"]>) {
        const result = await abort.apply(this, args);
        if (activityContext.getStore()?.requestId === requestId && ++aborted === 1) {
          assert.equal(await f.store.collection("CalendarEventLink").countDocuments(), 0);
          assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
          await f.forceOwner(row.operationId);
        }
        return result;
      });
      const guardPatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        if (this.collectionName === f.lock.leases.collectionName && args[2]?.session) guards++;
        return update.apply(this, args);
      });
      try { await assert.rejects(attributed(() => f.lock.withLock(row.operationId, async () => { callbacks++; await f.repo.saveCalendarEventLink(row); }), requestId), safeError); }
      finally { guardPatch.mock.restore(); abortPatch.mock.restore(); insertPatch.mock.restore(); }
      assert.equal(callbacks, 1); assert.equal(mappingInserts, 1); assert.equal(guards, 2); assert.ok(aborted >= 1);
      assert.equal(await f.store.collection("CalendarEventLink").countDocuments(), 0); assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
    });

    await suite.test("L11b native commit + in-budget forced owner/ACK fault => same txn commit retry, no new guard/callback", async () => {
      const f = await h.fixture(), row = link("synthetic-commit-recheck"), requestId = randomUUID();
      const original = ClientSession.prototype.commitTransaction, update = Collection.prototype.updateOne;
      let callbacks = 0, commits = 0, guards = 0, mappingReturned = false;
      const sessions: ClientSession[] = [];
      let successor: Awaited<ReturnType<typeof f.forceOwner>> | undefined;
      const patch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
        const result = await original.apply(this, args);
        if (activityContext.getStore()?.requestId === requestId) {
          sessions.push(this);
          if (++commits === 1) {
            assert.equal(await f.store.collection("CalendarEventLink").countDocuments(), 1);
            assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
            successor = await f.forceOwner(row.operationId);
            const error = new MongoServerError({ code: 91, message: privateEvent }); error.addErrorLabel("UnknownTransactionCommitResult"); throw error;
          }
          assert.ok(successor);
          assert.deepEqual(await f.lock.leases.findOne({ _id: row.operationId }), successor, "ACK 재확인 직후 B의 owner/generation/nonce/leaseUntil 모두 보존");
        }
        return result;
      });
      const guardPatch = mock.method(Collection.prototype, "updateOne", async function (this: Collection, ...args: Parameters<Collection["updateOne"]>) {
        if (this.collectionName === f.lock.leases.collectionName && args[2]?.session) guards++;
        return update.apply(this, args);
      });
      const observed = wire(h.client, h.databaseName), started = performance.now();
      try {
        await assert.rejects(attributed(() => f.lock.withLock(row.operationId, async () => {
          callbacks++; await f.repo.saveCalendarEventLink(row); mappingReturned = true;
        }), requestId), safeError);
      } finally { guardPatch.mock.restore(); patch.mock.restore(); observed.stop(); }
      assert.ok(performance.now() - started < 10_000, "자연 만료가 아닌 예산 내 fault fixture");
      assert.equal(callbacks, 1); assert.equal(guards, 1); assert.equal(commits, 2); assert.equal(mappingReturned, true);
      assert.equal(sessions[0], sessions[1]);
      const commitsOnWire = observed.commands.filter(event => event.commandName === "commitTransaction");
      assert.equal(commitsOnWire.length, 2);
      assert.deepEqual(commitsOnWire[0].command.lsid, commitsOnWire[1].command.lsid);
      assert.deepEqual(commitsOnWire[0].command.txnNumber, commitsOnWire[1].command.txnNumber);
      assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [row]); assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
      assert.ok(successor);
      assert.deepEqual(await f.lock.leases.findOne({ _id: row.operationId }), successor, "A의 최외곽 검사와 cleanup 이후에도 B의 전체 lease row 보존");
      assert.equal((await f.lock.leases.findOne({ _id: row.operationId }))?.generation.toString(), "2");
    });

    for (const mode of ["stale-mapping", "committed-ack"] as const) {
      await suite.test("L8/L6b native SIGSTOP/natural 60s expiry/handoff/SIGCONT: " + mode, { timeout: 110_000 }, async () => {
        const f = await h.fixture(), second = await f.otherLock(), operationId = "synthetic-paused-" + mode;
        const worker = fork(fileURLToPath(new URL("./mongoCalendarLeaseWorker.fixture.ts", import.meta.url)), [], {
          cwd: fileURLToPath(new URL("../../../", import.meta.url)),
          execArgv: ["--experimental-strip-types", "--experimental-loader", fileURLToPath(new URL("../../../scripts/ts-loader.mjs", import.meta.url))],
          // 상속 env/credentials 없이 parent가 생성한 합성 키와 전용 endpoint만 전달한다.
          env: { NODE_ENV: "test", MONGODB_CALENDAR_TEST_URI: CALENDAR_TEST_URI, ...h.keys }, stdio: ["ignore", "ignore", "pipe", "ipc"]
        });
        const messages: Record<string, unknown>[] = [], wake = barrier(), result = barrier();
        let workerFailure: Error | undefined;
        worker.on("message", message => {
          const value = message as Record<string, unknown>; messages.push(value);
          if (value.type === "failure") { workerFailure = new Error(String(value.code)); wake.resolve(); result.resolve(); }
          if (value.type === (mode === "stale-mapping" ? "acquired" : "committed")) wake.resolve();
          if (value.type === "result") result.resolve();
        });
        worker.on("error", error => { workerFailure = error; wake.resolve(); result.resolve(); });
        const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
          worker.once("exit", (code, signal) => { if (!messages.some(message => message.type === "result")) { workerFailure ??= new Error("Worker exited before result"); wake.resolve(); result.resolve(); } resolve({ code, signal }); });
        });
        // 파이프가 차서 가짜 process pause가 되지 않게 소비하되 원문 출력하지 않는다.
        worker.stderr?.on("data", () => {});
        worker.send({ databaseName: h.databaseName, namespace: f.options.namespace, operationId, mode });
        let stopped = false;
        try {
          await bounded(wake.promise, 15_000); if (workerFailure) throw workerFailure;
          const before = await second.leases.findOne({ _id: operationId }); assert.ok(before?.owner);
          let earlyCallbacks = 0;
          await assert.rejects(second.withLock(operationId, async () => { earlyCallbacks++; }), safeError);
          assert.equal(earlyCallbacks, 0, "정지/만료 전에는 다른 client의 callback 진입 불가");
          assert.equal(worker.kill("SIGSTOP"), true); stopped = true;
          // 첫 lease 만료까지 client 시계/mock/강제 owner write 없이 실제 server $$NOW만 관찰한다.
          const deadline = performance.now() + 75_000;
          while (!await second.leases.findOne({ _id: operationId, $expr: { $lte: ["$leaseUntil", "$$NOW"] } })) {
            assert.ok(performance.now() < deadline, "소유 process 정지 후 native lease가 실제 만료되어야 한다"); await sleep(500);
          }
          assert.equal(await f.store.collection("CalendarEventLink").countDocuments(), mode === "committed-ack" ? 1 : 0);
          await second.withLock(operationId, async handle => {
            const successor = await second.leases.findOne({ _id: operationId }, { readConcern: { level: "majority" } }); assert.ok(successor?.owner);
            assert.notEqual(successor.owner, before.owner); assert.ok(successor.generation.equals(before.generation.add(Long.ONE)));
            assert.equal(worker.kill("SIGCONT"), true); stopped = false; worker.send({ type: "resume" });
            await bounded(result.promise, 20_000); if (workerFailure) throw workerFailure;
            await handle.assertActive();
            assert.deepEqual(await second.leases.findOne({ _id: operationId }), successor, "stale guard/renew/release가 successor를 바꾸면 실패");
            assert.equal(await f.store.collection("CalendarEventLink").countDocuments(), mode === "committed-ack" ? 1 : 0);
            assert.equal(await f.store.collection("ActivityChange").countDocuments(), mode === "committed-ack" ? 1 : 0);
          });
          const outcome = await bounded(exited, 5_000); assert.equal(outcome.code, 0); assert.equal(outcome.signal, null);
          const report = messages.find(message => message.type === "result"); assert.ok(report);
          assert.equal(report.callbacks, 1); assert.equal(report.mappingReturned, false);
          assert.equal(report.commits, mode === "committed-ack" ? 1 : 0);
          // committed-ack는 DB10초 예산 종료 후 I0/F1에 대응하는 storage 상태다. API 집계는 별도 suite 소유.
        } finally {
          if (stopped) worker.kill("SIGCONT");
          await terminateOwnedWorker(worker, exited);
        }
      });
    }
  });
});

async function terminateOwnedWorker(worker: ChildProcess, exited: Promise<unknown>) {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill("SIGTERM");
  try { await bounded(exited, 3_000); }
  catch { worker.kill("SIGKILL"); await bounded(exited, 3_000); }
}
