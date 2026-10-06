/**
 * 전용 opt-in native storage suite. PG oracle/API/fake Google는 별도 소유다.
 * 기대값은 frozen PG calendarEventLinkRepository/PG trigger 및 validation-v2 literal 계약.
 * 실제 BSON 경계와 driver/clock fault를 구분하며 제품 오류에 맞춰 기대값을 완화하지 않는다.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { BSON, ClientSession, Collection, MongoServerError } from "mongodb";
import { activityContext } from "../activity/context";
import { isEncrypted } from "../privacy/crypto";
import { MongoCalendarPersistence, prepareMongoCalendarPersistenceStore } from "./mongoCalendarPersistence";
import { MongoCalendarOperationLock, prepareMongoCalendarLeaseStore } from "./mongoCalendarOperationLock";
import { attributed, calendarHarness, calendarOptIn, keyNames, link, privateActor, privateCalendar, privateEvent, safeError, sleep, wire } from "./mongoCalendarIntegrationFixtures";
import { MONGO_SCAN_BYTES, MONGO_SCAN_ROWS, MongoOperationError, operationMongoValidator } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoRuntimeCodecError } from "./mongoRuntimeCodec";

test("Calendar persistence: native storage / atomicity / scan / PII", { skip: !calendarOptIn, timeout: 600_000 }, async suite => {
  await calendarHarness(async h => {
    await suite.test("P1 literal CRUD: UTC date, stable id/createdAt, order, exact conditional mutation", async () => {
      const f = await h.fixture();
      const a = link("synthetic-a", "2099-12-02"), early = link("synthetic-a"), b = link("synthetic-b");
      assert.deepEqual(await f.repo.listAllCalendarEventLinks(), []);
      for (const row of [b, a, early]) await f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row));
      assert.deepEqual(await f.repo.listCalendarEventLinks(a.operationId), [early, a]);
      assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [early, a, b]);
      const before = await f.store.one("CalendarEventLink", { operationId: a.operationId, eventDate: new Date("2099-12-02T00:00:00Z") });
      assert.ok(before); assert.ok(before.createdAt instanceof Date); assert.ok(before.updatedAt instanceof Date);
      const replacement = { ...a, calendarId: "synthetic-replacement@example.invalid", eventId: "synthetic-new-event" };
      await sleep(5);
      await f.lock.withLock(a.operationId, async () => {
        await f.repo.saveCalendarEventLink(replacement);
        const after = await f.store.one("CalendarEventLink", { _id: String(before.id) });
        assert.ok(after); assert.equal(after.id, before.id); assert.deepEqual(after.createdAt, before.createdAt);
        assert.ok((after.updatedAt as Date).getTime() >= (before.updatedAt as Date).getTime());
        await f.repo.deleteMatchingCalendarEventLink(a); // 교체 전 event/calendar의 stale 삭제는 no-op.
        assert.deepEqual(await f.repo.listCalendarEventLinks(a.operationId), [early, replacement]);
        const raw = await f.snapshot();
        for (const stale of [a, { ...replacement, calendarId: "wrong" }, { ...replacement, eventId: "wrong" }, { ...replacement, eventDate: "2099-11-01" }]) {
          await assert.rejects(f.repo.moveCalendarEventLinkDate(stale, "2099-12-03"), safeError);
          assert.deepEqual(await f.snapshot(), raw);
        }
        await assert.rejects(f.repo.moveCalendarEventLinkDate(replacement, early.eventDate), safeError);
        assert.deepEqual(await f.snapshot(), raw);
        await f.repo.moveCalendarEventLinkDate(replacement, "2099-12-03");
        assert.deepEqual(await f.repo.listCalendarEventLinks(a.operationId), [early, { ...replacement, eventDate: "2099-12-03" }]);
        await f.repo.deleteCalendarEventLink(a.operationId, "2099-11-01");
        await f.repo.deleteCalendarEventLink(a.operationId, early.eventDate);
        await f.repo.deleteMatchingCalendarEventLink({ ...replacement, eventDate: "2099-12-03" });
        assert.deepEqual(await f.repo.listCalendarEventLinks(a.operationId), []);
        await f.repo.deleteCalendarEventLinks(a.operationId);
      });
      assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [b]);
      await f.lock.withLock(b.operationId, () => f.repo.deleteCalendarEventLinks(b.operationId));
      assert.deepEqual(await f.repo.listAllCalendarEventLinks(), []);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0, "activity context 없는 직접 호출은 감사 0");
    });

    await suite.test("P1/P2 native compound uniqueness, non-unique reverse Map candidate set, date validation", async () => {
      const f = await h.fixture(), a = link("synthetic-a"), b = link("synthetic-b", "2099-12-02");
      for (const row of [a, b]) await f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row));
      const reverse = await f.repo.findCalendarEventLinksByCalendar(privateCalendar);
      assert.equal(reverse.size, 1);
      assert.ok([a, b].some(candidate => isDeepStrictEqual(candidate, reverse.get(privateEvent))), "무정렬 Map의 값은 실제 두 후보 중 하나");
      assert.deepEqual(await f.repo.findCalendarEventLinksByCalendar("missing@example.invalid"), new Map());
      await assert.rejects(f.seed("CalendarEventLink", { ...a, eventDate: new Date(a.eventDate) }), error => {
        assert.ok(error instanceof MongoServerError); assert.equal(error.code, 11000); return true;
      });
      const before = await f.snapshot();
      await f.lock.withLock(a.operationId, async () => {
        for (const eventDate of ["2099-02-29", "2099-13-01", "2099-12-01T00:00:00Z", "", "2099-2-01"]) {
          await assert.rejects(f.repo.saveCalendarEventLink({ ...a, eventDate }), safeError);
        }
      });
      assert.deepEqual(await f.snapshot(), before);
    });

    await suite.test("P2/S2 native encryption + PG trigger literal field set / same-plaintext re-encryption", async () => {
      const f = await h.fixture(), row = link(), requestId = randomUUID();
      await attributed(() => f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row)), requestId);
      const raw = await f.store.collection("CalendarEventLink").findOne({ operationId: row.operationId }); assert.ok(raw);
      assert.ok(isEncrypted(raw.calendarId)); assert.ok(isEncrypted(raw.eventId)); assert.match(raw.calendarIdPiiIndex as string, /^[a-f0-9]{64}$/);
      const audits = await f.store.scan("ActivityChange", { requestId }); assert.equal(audits.length, 1);
      assert.equal(audits[0].action, "create"); assert.equal(audits[0].targetType, "calendar_event_links"); assert.equal(audits[0].targetId, raw._id);
      assert.equal(audits[0].actorEmail, privateActor); assert.equal(audits[0].actorName, "가상 Calendar 작성자");
      assert.equal(audits[0].actorType, "user"); assert.equal(audits[0].route, "/synthetic/calendar-storage"); assert.equal(audits[0].method, "POST");
      assert.deepEqual(audits[0].changes, { operation_id: { before: null, after: row.operationId },
        event_date: { before: null, after: "2099-12-01" }, calendar_id: { redacted: true }, event_id: { redacted: true } });
      // frozen schema/fields에는 두 ID의 HMAC이 모두 있다. trigger는 동일 HMAC을 제외하므로 감사 0이다.
      const repeated = randomUUID();
      await attributed(() => f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row)), repeated);
      const second = await f.store.scan("ActivityChange", { requestId: repeated });
      assert.equal(second.length, 0, "동일 원문/동일 HMAC은 재암호화되어도 PG 감사 0");
      const reencrypted = await f.store.collection("CalendarEventLink").findOne({ _id: raw._id }); assert.ok(reencrypted);
      assert.notEqual(reencrypted.calendarId, raw.calendarId); assert.notEqual(reencrypted.eventId, raw.eventId);
      assert.equal(reencrypted.calendarIdPiiIndex, raw.calendarIdPiiIndex); assert.equal(reencrypted.eventIdPiiIndex, raw.eventIdPiiIndex);
      const changedRequest = randomUUID();
      await attributed(() => f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink({ ...row, eventId: "synthetic-actually-changed" })), changedRequest);
      const changed = await f.store.scan("ActivityChange", { requestId: changedRequest }); assert.equal(changed.length, 1);
      assert.equal(changed[0].action, "update"); assert.deepEqual(changed[0].changes, { event_id: { redacted: true } });
      const deletion = randomUUID();
      await attributed(() => f.lock.withLock(row.operationId, () => f.repo.deleteCalendarEventLinks(row.operationId)), deletion);
      const last = await f.store.scan("ActivityChange", { requestId: deletion }); assert.equal(last.length, 1);
      assert.equal(last[0].action, "delete");
      assert.deepEqual(last[0].changes, { operation_id: { before: row.operationId, after: null },
        event_date: { before: "2099-12-01", after: null }, calendar_id: { redacted: true }, event_id: { redacted: true } });
      const rawAudits = JSON.stringify(await f.store.collection("ActivityChange").find({}).toArray());
      for (const secret of [privateCalendar, privateEvent, privateActor, "가상 Calendar 작성자"]) {
        assert.ok(!JSON.stringify(raw).includes(secret)); assert.ok(!rawAudits.includes(secret));
      }
    });

    await suite.test("P3 updatedAt exact Map includes deleted rows, deduplicates input and omits missing", async () => {
      const f = await h.fixture(), at = new Date("2099-02-01T12:34:56.789Z"), later = new Date("2099-02-02T12:34:56.789Z");
      await f.seed("OperationSession", { operationId: "synthetic-alive", updatedAt: at, deletedAt: null });
      await f.seed("OperationSession", { operationId: "synthetic-deleted", updatedAt: at, deletedAt: later });
      await f.seed("OperationSession", { operationId: "synthetic-later", updatedAt: later });
      assert.deepEqual(await f.repo.findOperationUpdatedAt([]), new Map());
      assert.deepEqual(await f.repo.findOperationUpdatedAt(["absent"]), new Map());
      const result = await f.repo.findOperationUpdatedAt(["synthetic-alive", "absent", "synthetic-deleted", "synthetic-alive", "synthetic-later"]);
      assert.equal(result.size, 3); assert.deepEqual(result.get("synthetic-alive"), at);
      assert.deepEqual(result.get("synthetic-deleted"), at); assert.deepEqual(result.get("synthetic-later"), later);
    });

    await suite.test("mapping mutators require the matching held lease, including no-op deletes", async () => {
      const f = await h.fixture(), row = link();
      const mutations = [() => f.repo.saveCalendarEventLink(row), () => f.repo.deleteCalendarEventLink(row.operationId, row.eventDate),
        () => f.repo.deleteCalendarEventLinks(row.operationId), () => f.repo.moveCalendarEventLinkDate(row, "2099-12-02"), () => f.repo.deleteMatchingCalendarEventLink(row)];
      for (const mutate of mutations) {
        await assert.rejects(mutate, /CALENDAR_LEASE_REQUIRED/);
        await f.lock.withLock("synthetic-other", () => assert.rejects(mutate, /CALENDAR_LEASE_REQUIRED/));
      }
      assert.deepEqual(await f.repo.listAllCalendarEventLinks(), []);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
    });

    for (const mutation of ["insert", "update", "move", "delete", "delete-all"] as const) {
      await suite.test("M2 native audit validator failure rolls back mapping + audit + guard: " + mutation, async () => {
        const f = await h.fixture(), row = link();
        if (mutation !== "insert") {
          await attributed(() => f.lock.withLock(row.operationId, async () => {
            await f.repo.saveCalendarEventLink(row); await f.repo.saveCalendarEventLink({ ...row, eventDate: "2099-12-02" });
          }));
        }
        const original = operationMongoValidator("ActivityChange");
        await f.store.db.command({ collMod: f.store.collection("ActivityChange").collectionName, validator: { $and: [original, { action: "synthetic-impossible-action" }] } });
        try {
          await attributed(() => f.lock.withLock(row.operationId, async () => {
            const before = await f.snapshot(), lease = await f.lock.leases.findOne({ _id: row.operationId });
            const change = mutation === "insert" ? () => f.repo.saveCalendarEventLink(row)
              : mutation === "update" ? () => f.repo.saveCalendarEventLink({ ...row, eventId: "synthetic-replaced" })
              : mutation === "move" ? () => f.repo.moveCalendarEventLinkDate(row, "2099-12-03")
              : mutation === "delete" ? () => f.repo.deleteMatchingCalendarEventLink(row) : () => f.repo.deleteCalendarEventLinks(row.operationId);
            await assert.rejects(change, safeError);
            assert.deepEqual(await f.snapshot(), before, "암호문/id/timestamp까지 전체 rollback");
            assert.deepEqual(await f.lock.leases.findOne({ _id: row.operationId }), lease, "transaction nonce guard도 rollback");
          }));
        } finally { await f.store.db.command({ collMod: f.store.collection("ActivityChange").collectionName, validator: original }); }
      });
    }

    for (const acknowledged of [true, false]) {
      await suite.test("M6 driver ACK fault AFTER native commit, mapping/audit inseparable: " + acknowledged, async () => {
        const f = await h.fixture(), row = link(), requestId = randomUUID();
        const original = ClientSession.prototype.commitTransaction;
        let commits = 0, callbacks = 0;
        const patch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
          const result = await original.apply(this, args);
          if (activityContext.getStore()?.requestId === requestId && ++commits === 1) {
            const error = new MongoServerError({ code: acknowledged ? 91 : 50, message: privateEvent });
            error.addErrorLabel("UnknownTransactionCommitResult"); throw error;
          }
          return result;
        });
        try {
          const pending = attributed(() => f.lock.withLock(row.operationId, async () => { callbacks++; await f.repo.saveCalendarEventLink(row); }), requestId);
          if (acknowledged) await pending; else await assert.rejects(pending, safeError);
        } finally { patch.mock.restore(); }
        assert.equal(callbacks, 1); assert.equal(commits, acknowledged ? 2 : 1);
        assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [row]);
        assert.equal(await f.store.collection("ActivityChange").countDocuments({ requestId }), 1);
      });
    }

    await suite.test("M7 storage partial: first mapping committed, second transaction abort preserves first", async () => {
      const f = await h.fixture(), first = link(), second = { ...first, eventDate: "2099-12-02" };
      const original = Collection.prototype.insertOne; let failures = 0;
      const patch = mock.method(Collection.prototype, "insertOne", async function (this: Collection, ...args: Parameters<Collection["insertOne"]>) {
        if (this.collectionName === f.store.collection("CalendarEventLink").collectionName && (args[0].eventDate as Date).toISOString().startsWith("2099-12-02")) {
          failures++; throw new Error(privateEvent);
        }
        return original.apply(this, args);
      });
      try {
        await assert.rejects(attributed(() => f.lock.withLock(first.operationId, async () => {
          await f.repo.saveCalendarEventLink(first); await f.repo.saveCalendarEventLink(second);
        })), safeError);
      } finally { patch.mock.restore(); }
      assert.equal(failures, 1); assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [first]);
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 1);
    });

    await suite.test("M10/M11 storage scope: valid compensation succeeds, LOST compensation rejects, unrelated writer can commit", async () => {
      const f = await h.fixture(), row = link(), moved = { ...row, eventDate: "2099-12-02" };
      await f.seed("OperationSession", { operationId: row.operationId, updatedAt: new Date("2099-01-01"), deletedAt: null });
      await f.lock.withLock(row.operationId, async () => {
        await f.repo.saveCalendarEventLink(row); await f.repo.moveCalendarEventLinkDate(row, moved.eventDate);
        await f.repo.moveCalendarEventLinkDate(moved, row.eventDate);
        assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [row]);
      });
      await assert.rejects(f.lock.withLock(row.operationId, async handle => {
        await f.repo.moveCalendarEventLinkDate(row, moved.eventDate);
        await f.forceOwner(row.operationId); await assert.rejects(handle.assertActive(), safeError);
        await assert.rejects(f.repo.moveCalendarEventLinkDate(moved, row.eventDate), safeError);
        // native 별도 operation write는 mapping fence 대상이 아니다. 실제 operation repository API 검증은 별도 suite.
        const result = await f.store.collection("OperationSession").updateOne({ operationId: row.operationId }, { $set: { updatedAt: new Date("2099-01-02") } });
        assert.equal(result.modifiedCount, 1);
      }), safeError);
      assert.deepEqual(await f.repo.listAllCalendarEventLinks(), [moved]);
      assert.deepEqual((await f.repo.findOperationUpdatedAt([row.operationId])).get(row.operationId), new Date("2099-01-02"));
    });

    for (const damage of ["validator", "missing-index", "extra-unique", "same-key-extra-unique", "ttl", "capped"] as const) {
      await suite.test("M1 open/prepare refuse altered mapping metadata without repair: " + damage, async () => {
        const f = await h.fixture(), collection = f.store.collection("CalendarEventLink");
        if (damage === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "off" });
        if (damage === "missing-index") {
          const indexes = await collection.listIndexes().toArray(); const unique = indexes.find(index => index.unique && index.name !== "_id_"); assert.ok(unique?.name);
          await collection.dropIndex(unique.name);
        }
        if (damage === "extra-unique") await collection.createIndex({ eventId: 1 }, { unique: true });
        if (damage === "same-key-extra-unique") {
          const known = (await collection.listIndexes().toArray()).find(index => index.unique && index.name !== "_id_"); assert.ok(known);
          await collection.createIndex(known.key, { name: "synthetic_same_key_stricter_collation", unique: true, collation: { locale: "en", strength: 2 } });
        }
        if (damage === "ttl") await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 });
        if (damage === "capped") {
          const info = await f.store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next(); assert.ok(info);
          const indexes = (await collection.listIndexes().toArray()).filter(index => index.name !== "_id_");
          await collection.drop();
          await f.store.db.createCollection(collection.collectionName, { ...info.options, capped: true, size: 1024 * 1024 });
          for (const index of indexes) await collection.createIndex(index.key, { name: index.name, ...(index.unique === true ? { unique: true } : {}) });
        }
        const before = await f.metadata(), raw = await f.snapshot();
        await assert.rejects(MongoCalendarPersistence.open(f.options, f.lock), safeError);
        await assert.rejects(prepareMongoCalendarPersistenceStore(f.options), safeError);
        assert.deepEqual(await f.metadata(), before); assert.deepEqual(await f.snapshot(), raw);
      });
    }

    for (const model of ["OperationSession", "ActivityChange"] as const) {
      for (const damage of ["validator", "missing-index"] as const) {
        for (const missingMapping of [false, true]) {
          await suite.test(`M1 shared ${model} ${damage}: reject without repair${missingMapping ? " or creating missing mapping" : " of existing collections"}`, async () => {
            const f = await h.fixture(), row = link("synthetic-shared-metadata");
            await f.seed("OperationSession", { operationId: row.operationId });
            await attributed(() => f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row)));
            const collection = f.store.collection(model);
            if (damage === "validator") {
              await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "off" });
            } else {
              const required = (await collection.listIndexes().toArray()).find(index => index.name !== "_id_");
              assert.ok(required?.name); await collection.dropIndex(required.name);
            }
            // CalendarEventLink는 준비 순서상 앞에 있다. 뒤의 공유 모델이 잘못되면 앞의 누락 모델도 만들면 안 된다.
            if (missingMapping) await f.store.collection("CalendarEventLink").drop();
            const metadata = await f.metadata(), raw = await f.snapshot(), leases = await f.lock.leases.find({}).toArray();
            const observed = wire(h.client, h.databaseName);
            try {
              await assert.rejects(prepareMongoCalendarPersistenceStore(f.options), error => {
                safeError(error);
                assert.equal((error as MongoOperationError).code, damage === "validator" ? "VALIDATOR_NOT_READY" : "INDEX_NOT_READY");
                return true;
              });
              await assert.rejects(MongoCalendarPersistence.open(f.options, f.lock), safeError);
              const writeCommands = new Set(["create", "collMod", "createIndexes", "drop", "dropIndexes", "insert", "update", "delete", "findAndModify"]);
              assert.deepEqual(observed.commands.filter(event => writeCommands.has(event.commandName)).map(event => event.commandName), [],
                "실패 전 metadata 수리/생성 또는 업무/coordination 쓰기가 없어야 한다");
            } finally { observed.stop(); }
            assert.deepEqual(await f.metadata(), metadata);
            assert.deepEqual(await f.snapshot(), raw, "기존 업무/감사의 암호문·ID·시각까지 보존");
            assert.deepEqual(await f.lock.leases.find({}).toArray(), leases);
            if (missingMapping) assert.equal(await f.store.db.listCollections({ name: f.store.collection("CalendarEventLink").collectionName }).next(), null);
          });
        }
      }
    }

    for (const model of ["CalendarEventLink", "OperationSession", "ActivityChange"] as const) {
      await suite.test(`M1 ${model}: current metadata with historical invalid document rejects prepare without mutations`, async () => {
        const f = await h.fixture(), row = link("synthetic-historical-invalid");
        await f.seed("OperationSession", { operationId: row.operationId });
        await attributed(() => f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row)));
        const collection = f.store.collection(model), existing = await collection.findOne({}); assert.ok(existing);
        const validMetadata = await f.metadata();
        // 현재 strict validator/index는 그대로 두고, 과거 정책 또는 우회 쓰기로 남은 부적합 문서만 재현한다.
        const damage = model === "CalendarEventLink" ? { calendarId: privateCalendar }
          : model === "OperationSession" ? { operationStatus: "SYNTHETIC_LEGACY_INVALID_STATUS" }
          : { occurredAt: "2099-12-01T00:00:00.000Z" };
        const injected = await collection.updateOne({ _id: existing._id }, { $set: damage }, { bypassDocumentValidation: true });
        assert.equal(injected.modifiedCount, 1);
        assert.deepEqual(await f.metadata(), validMetadata);
        assert.equal(await collection.countDocuments({ $nor: [operationMongoValidator(model)] }), 1);

        const missingModel = model === "CalendarEventLink" ? "OperationSession" : "CalendarEventLink";
        for (const missingOther of [false, true]) {
          // 동일 case에서 전체 존재와 타 컬렉션 누락을 각각 확인한다. 부적합 문서가 있으면 누락분도 생성하지 않는다.
          if (missingOther) await f.store.collection(missingModel).drop();
          const metadata = await f.metadata(), raw = await f.snapshot(), leases = await f.lock.leases.find({}).toArray();
          const observed = wire(h.client, h.databaseName);
          try {
            await assert.rejects(prepareMongoCalendarPersistenceStore(f.options), error => {
              safeError(error); assert.equal((error as MongoOperationError).code, "EXISTING_DOCUMENTS_POLICY_MISMATCH"); return true;
            });
            const writeCommands = new Set(["create", "collMod", "createIndexes", "drop", "dropIndexes", "insert", "update", "delete", "findAndModify"]);
            assert.deepEqual(observed.commands.filter(event => writeCommands.has(event.commandName)).map(event => event.commandName), [],
              "기존 문서 정책 확인은 읽기 전용이며 수리/생성/쓰기 모두 0");
          } finally { observed.stop(); }
          assert.deepEqual(await f.metadata(), metadata);
          assert.deepEqual(await f.snapshot(), raw, "부적합 문서와 기존 업무/감사의 raw 값까지 보존");
          assert.deepEqual(await f.lock.leases.find({}).toArray(), leases);
          if (missingOther) assert.equal(await f.store.db.listCollections({ name: f.store.collection(missingModel).collectionName }).next(), null);
        }
      });
    }

    await suite.test("M1 healthy existing three-model store: repeated prepare succeeds without repair or creation", async () => {
      const f = await h.fixture(), row = link("synthetic-existing-ready");
      await f.seed("OperationSession", { operationId: row.operationId });
      await attributed(() => f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row)));
      const metadata = await f.metadata(), raw = await f.snapshot(), observed = wire(h.client, h.databaseName);
      try {
        await prepareMongoCalendarPersistenceStore(f.options);
        const reopened = await MongoCalendarPersistence.open(f.options, f.lock);
        assert.deepEqual(await reopened.listAllCalendarEventLinks(), [row]);
        const writeCommands = new Set(["create", "collMod", "createIndexes", "insert", "update", "delete", "findAndModify"]);
        assert.deepEqual(observed.commands.filter(event => writeCommands.has(event.commandName)).map(event => event.commandName), []);
      } finally { observed.stop(); }
      assert.deepEqual(await f.metadata(), metadata); assert.deepEqual(await f.snapshot(), raw);
    });

    await suite.test("M1 shadow gates/unprepared storage/mismatched lock fail without writes", async () => {
      const f = await h.fixture(), before = await f.metadata();
      for (const options of [{ ...f.options, allowShadowWrites: false }, { ...f.options, databaseName: "production" },
        { ...f.options, namespace: "production" }, { ...f.options, namespace: "shadow_absent_" + randomBytes(8).toString("hex") }]) {
        await assert.rejects(MongoCalendarPersistence.open(options as typeof f.options, f.lock), safeError);
      }
      const other = await h.fixture();
      await assert.rejects(MongoCalendarPersistence.open(f.options, other.lock), safeError);
      const emptyOptions = { ...f.options, namespace: "shadow_missing_" + randomBytes(8).toString("hex") };
      // open이 Calendar metadata를 생성하지 않아야 한다.
      await assert.rejects(MongoCalendarOperationLock.open(emptyOptions), safeError);
      await prepareMongoCalendarLeaseStore(emptyOptions);
      const emptyLock = await MongoCalendarOperationLock.open(emptyOptions);
      const emptyBefore = await f.store.db.listCollections({ name: { $regex: "^" + emptyOptions.namespace + "_" } }).toArray();
      await assert.rejects(MongoCalendarPersistence.open(emptyOptions, emptyLock), safeError);
      assert.deepEqual(await f.store.db.listCollections({ name: { $regex: "^" + emptyOptions.namespace + "_" } }).toArray(), emptyBefore);
      assert.deepEqual(await f.metadata(), before);
    });

    for (const invalid of ["json", "base64", "active-id", "same-key"] as const) {
      await suite.test("K1 malformed privacy configuration fails before writes: " + invalid, async () => {
        const f = await h.fixture(), before = await f.snapshot(), observed = wire(h.client, h.databaseName);
        try {
          if (invalid === "json") process.env.PII_ENCRYPTION_KEYS = "{";
          if (invalid === "base64") process.env.PII_INDEX_KEY = "not-base64";
          if (invalid === "active-id") process.env.PII_ACTIVE_KEY_ID = "bad:id";
          if (invalid === "same-key") process.env.PII_INDEX_KEY = JSON.parse(h.keys.PII_ENCRYPTION_KEYS).calendar;
          await assert.rejects(MongoCalendarPersistence.open(f.options, f.lock), safeError);
          assert.equal(observed.commands.length, 0);
        } finally { Object.assign(process.env, h.keys); observed.stop(); }
        assert.deepEqual(await f.snapshot(), before);
      });
    }

    for (const damage of ["wrong-encryption", "tag", "context", "envelope", "wrong-index"] as const) {
      await suite.test("K2/K3/K4 actual read distinguishes corruption from HMAC miss: " + damage, async () => {
        const f = await h.fixture(), row = link(); await f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row));
        const collection = f.store.collection("CalendarEventLink"), raw = await collection.findOne({ operationId: row.operationId }); assert.ok(raw);
        if (damage === "tag") {
          const pieces = String(raw.eventId).split(":"); pieces[4] = (pieces[4][0] === "A" ? "B" : "A") + pieces[4].slice(1);
          await collection.updateOne({ _id: raw._id }, { $set: { eventId: pieces.join(":") } });
        }
        if (damage === "context") await collection.updateOne({ _id: raw._id }, { $set: { eventId: raw.calendarId } });
        if (damage === "envelope") await collection.updateOne({ _id: raw._id }, { $set: { eventId: "pii:v1:broken" } }, { bypassDocumentValidation: true });
        const before = await f.snapshot();
        try {
          if (damage === "wrong-encryption") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ calendar: randomBytes(32).toString("base64") });
          if (damage === "wrong-index") process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
          const reopened = await MongoCalendarPersistence.open(f.options, f.lock); // metadata open은 암호문 복호화 증거가 아니다.
          if (damage === "wrong-index") {
            assert.deepEqual(await reopened.findCalendarEventLinksByCalendar(privateCalendar), new Map());
            assert.throws(() => decodeMongoRuntimeDocument("CalendarEventLink", raw), error => {
              assert.ok(error instanceof MongoRuntimeCodecError); assert.equal(error.code, "INDEX_MISMATCH"); return true;
            });
          }
          else await assert.rejects(reopened.findCalendarEventLinksByCalendar(privateCalendar), safeError);
          await assert.rejects(reopened.listAllCalendarEventLinks(), safeError);
          await assert.rejects(reopened.listCalendarEventLinks(row.operationId), safeError);
          assert.deepEqual(await f.snapshot(), before);
        } finally { Object.assign(process.env, h.keys); }
      });
    }

    await suite.test("M12 native 20,000 / 20,001 rows across all mapping read paths", async () => {
      assert.equal(MONGO_SCAN_ROWS, 20_000);
      const f = await h.fixture(), operationId = "synthetic-many";
      for (let start = 0; start < 20_000; start += 500) {
        await f.store.collection("CalendarEventLink").insertMany(Array.from({ length: 500 }, (_, offset) => {
          const n = start + offset;
          return encodeMongoRuntimeDocument("CalendarEventLink", coachFixtureRow("CalendarEventLink", {
            operationId, eventDate: new Date(Date.UTC(2000, 0, n + 1)), calendarId: privateCalendar, eventId: "synthetic-event-" + n
          }));
        }));
      }
      assert.equal((await f.repo.listAllCalendarEventLinks()).length, 20_000);
      assert.equal((await f.repo.listCalendarEventLinks(operationId)).length, 20_000);
      assert.equal((await f.repo.findCalendarEventLinksByCalendar(privateCalendar)).size, 20_000);
      await f.seed("CalendarEventLink", { operationId, eventDate: new Date(Date.UTC(2000, 0, 20_001)), calendarId: privateCalendar, eventId: "synthetic-overflow" });
      for (const read of [() => f.repo.listAllCalendarEventLinks(), () => f.repo.listCalendarEventLinks(operationId), () => f.repo.findCalendarEventLinksByCalendar(privateCalendar)]) {
        await assert.rejects(read, /SCAN_LIMIT_EXCEEDED/);
      }
      assert.equal(await f.store.collection("ActivityChange").countDocuments(), 0);
    });

    await suite.test("M12 native updatedAt scan 20,000 / 20,001 rows", async () => {
      const f = await h.fixture(), ids = Array.from({ length: 20_001 }, (_, n) => "synthetic-timestamp-" + n), at = new Date("2099-01-02");
      for (let start = 0; start < 20_000; start += 500) {
        await f.store.collection("OperationSession").insertMany(ids.slice(start, start + 500).map(operationId =>
          encodeMongoRuntimeDocument("OperationSession", coachFixtureRow("OperationSession", { operationId, updatedAt: at }))));
      }
      const result = await f.repo.findOperationUpdatedAt(ids); assert.equal(result.size, 20_000);
      assert.ok([...result.values()].every(value => value.getTime() === at.getTime()));
      await f.seed("OperationSession", { operationId: ids[20_000], updatedAt: at });
      await assert.rejects(f.repo.findOperationUpdatedAt(ids), /SCAN_LIMIT_EXCEEDED/);
    });

    await suite.test("M12 native encrypted BSON 32MiB-1/exact/+1, every mapping scan path", async () => {
      assert.equal(MONGO_SCAN_BYTES, 32 * 1024 * 1024);
      const f = await h.fixture(), collection = f.store.collection("CalendarEventLink");
      const base = Array.from({ length: 5 }, (_, n) => coachFixtureRow("CalendarEventLink", {
        operationId: "synthetic-bytes", eventDate: new Date(Date.UTC(2099, 11, n + 1)), calendarId: privateCalendar, eventId: "evt"
      }));
      // 공통 공개 operationId로 큰 BSON을 만들고, 유효 암호문의 길이 조합으로 정확한 byte 경계를 맞춘다.
      const initial = base.map(row => encodeMongoRuntimeDocument("CalendarEventLink", row));
      const overhead = initial.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0);
      for (const delta of [-1, 0, 1]) {
        const target = MONGO_SCAN_BYTES + delta;
        const padding = Math.floor((target - overhead) / 5) - 4;
        const operationId = "synthetic-bytes" + "x".repeat(padding);
        let smallDocuments: ReturnType<typeof encodeMongoRuntimeDocument>[] | undefined;
        for (let a = 0; a < 24 && !smallDocuments; a++) for (let b = 0; b < 24 && !smallDocuments; b++) {
          const candidate = base.map((row, n) => encodeMongoRuntimeDocument("CalendarEventLink", { ...row,
            eventId: "evt" + "x".repeat(n === 0 ? a : n === 1 ? b : 0) }));
          if (candidate.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0) + padding * 5 === target) smallDocuments = candidate;
        }
        assert.ok(smallDocuments, "암호화 실제 BSON의 정확한 byte fixture를 찾는다");
        const documents = smallDocuments.map(row => ({ ...row, operationId }));
        assert.ok(documents.every(row => BSON.calculateObjectSize(row) < 16 * 1024 * 1024));
        await collection.deleteMany({}); await collection.insertMany(documents);
        const measured = (await collection.find({}).toArray()).reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0);
        assert.equal(measured, target);
        for (const read of [() => f.repo.listAllCalendarEventLinks(), () => f.repo.listCalendarEventLinks(operationId), () => f.repo.findCalendarEventLinksByCalendar(privateCalendar)]) {
          if (delta <= 0) {
            const result = await read();
            if (Array.isArray(result)) assert.equal(result.length, 5);
            else { assert.ok(result.size >= 1 && result.size <= 3); assert.ok([...result.values()].every(value => value.operationId === operationId)); }
          } else await assert.rejects(read, /SCAN_LIMIT_EXCEEDED/);
        }
      }
    });

    await suite.test("M12 native updatedAt BSON byte boundary uses complete encrypted documents", async () => {
      const f = await h.fixture(), collection = f.store.collection("OperationSession");
      for (let n = 0; n < 5; n++) await f.seed("OperationSession", { operationId: "synthetic-bytes-" + n, sourceFingerprint: "synthetic-fingerprint-" + n });
      const rows = await collection.find({}).sort({ _id: 1 }).toArray();
      let remaining = 32 * 1024 * 1024 - 1 - rows.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0);
      for (let n = 0; n < rows.length; n++) {
        const padding = Math.floor(remaining / (rows.length - n)); remaining -= padding;
        rows[n].sourceFingerprint = String(rows[n].sourceFingerprint) + "x".repeat(padding);
        await collection.replaceOne({ _id: rows[n]._id }, rows[n]);
      }
      const ids = rows.map(row => String(row.operationId)), last = rows[4];
      assert.equal(rows.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0), 32 * 1024 * 1024 - 1);
      for (const extra of [0, 1, 2]) {
        const changed = { ...last, sourceFingerprint: last.sourceFingerprint + "x".repeat(extra) };
        await collection.replaceOne({ _id: last._id }, changed);
        if (extra < 2) assert.equal((await f.repo.findOperationUpdatedAt(ids)).size, 5);
        else await assert.rejects(f.repo.findOperationUpdatedAt(ids), /SCAN_LIMIT_EXCEEDED/);
      }
    });

    for (const path of ["all", "operation", "private", "timestamps"] as const) {
      await suite.test("M12 15s deadline after native page (labelled clock injection): " + path, async () => {
        const f = await h.fixture(), row = link();
        await f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row));
        await f.seed("OperationSession", { operationId: row.operationId });
        const model = path === "timestamps" ? "OperationSession" : "CalendarEventLink";
        const find = Collection.prototype.find, now = performance.now.bind(performance); let offset = 0, pages = 0;
        const clock = mock.method(performance, "now", () => now() + offset);
        const patch = mock.method(Collection.prototype, "find", function (this: Collection, ...args: Parameters<Collection["find"]>) {
          const cursor = find.apply(this, args);
          if (this.collectionName === f.store.collection(model).collectionName) {
            const close = cursor.close.bind(cursor);
            cursor.close = async (...closeArgs: Parameters<typeof cursor.close>) => {
              const value = await close(...closeArgs); if (++pages === 1) offset += 15_001; return value;
            };
          }
          return cursor;
        });
        try {
          const read = path === "all" ? () => f.repo.listAllCalendarEventLinks() : path === "operation" ? () => f.repo.listCalendarEventLinks(row.operationId)
            : path === "private" ? () => f.repo.findCalendarEventLinksByCalendar(privateCalendar) : () => f.repo.findOperationUpdatedAt([row.operationId]);
          await assert.rejects(read, error => { safeError(error); assert.equal((error as MongoOperationError).code, "SCAN_TIMEOUT"); return true; });
          assert.ok(pages >= 1);
        } finally { patch.mock.restore(); clock.mock.restore(); }
      });
    }

    await suite.test("M12 actual 15s elapsed driver-response delay after native cursor read (not clock or server failpoint)", { timeout: 30_000 }, async () => {
      const f = await h.fixture(), row = link();
      await f.lock.withLock(row.operationId, () => f.repo.saveCalendarEventLink(row));
      const original = Collection.prototype.find; let delayed = false;
      const patch = mock.method(Collection.prototype, "find", function (this: Collection, ...args: Parameters<Collection["find"]>) {
        const cursor = original.apply(this, args);
        if (this.collectionName === f.store.collection("CalendarEventLink").collectionName) {
          const next = cursor.next.bind(cursor);
          cursor.next = async () => {
            const result = await next();
            if (result && !delayed) { delayed = true; await sleep(15_100); }
            return result;
          };
        }
        return cursor;
      });
      const start = performance.now();
      try {
        await assert.rejects(f.repo.listAllCalendarEventLinks(), /SCAN_TIMEOUT/);
        assert.equal(delayed, true); assert.ok(performance.now() - start >= 15_000);
      } finally { patch.mock.restore(); }
    });
    assert.deepEqual(keyNames.map(name => process.env[name]), keyNames.map(name => h.keys[name]));
  });
});
