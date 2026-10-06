import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { MongoCoachManagerMyPageRepository, prepareMongoCoachManagerMyPageStore } from "./mongoCoachManagerMyPageRepository";
import { MongoOperationError, MongoOperationStore, completeMongoRow, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { isEncrypted } from "../privacy/crypto";
import { canonicalManagerCourses, coachManagerMyPageFixtures, expectedManagerCourses, expectedManagerReservations, MANAGER_EMAIL, MANAGER_NAME, OTHER_MANAGER_EMAIL, MY_PAGE_IDS as ids, managerDay, managerFixtureId } from "./coachManagerMyPageFixtures";

const uri = process.env.MONGODB_MANAGER_MY_PAGE_TEST_URI;
const models = ["Coach", "TeamUser", "CoachDayReservation", "CoachEngagement", "CoachEngagementSchedule"] as const;
function noStorageFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!/PiiIndex$|Encrypted$|^_id$|^reservedByEmail$|^hiredByText$|^email$|^slackId$/.test(key), `private storage field leaked: ${key}`);
    noStorageFields(child);
  }
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic snapshot barrier deadline")), 10_000); })]); }
  finally { clearTimeout(timer); }
}

test("manager my-page repository on an isolated Mongo replica set", { skip: !uri, timeout: 240_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["replicaSet"]); assert.ok(url.searchParams.get("replicaSet"));
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_manager_page_${randomBytes(8).toString("hex")}`;
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_manager_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoCoachManagerMyPageStore(options);
    const store = new MongoOperationStore(options, models);
    for (const [model, rows] of coachManagerMyPageFixtures()) await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    const repo = await MongoCoachManagerMyPageRepository.open(options);
    const insert = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values);
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row));
      return row;
    };
    const replace = async (model: string, id: string, values: MongoRow) => {
      const row = await store.one(model, { _id: id }); assert.ok(row);
      await store.collection(model).replaceOne({ _id: id }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...row, ...values })));
    };
    return { options, store, repo, insert, replace };
  }
  try {
    await client.connect(); connected = true;
    await suite.test("fixed legacy DTOs preserve cross-coach links, dedup, grouping, status, review and active rounds", async () => {
      const f = await fixture();
      assert.deepEqual(await f.repo.listMyActiveReservations(MANAGER_EMAIL), expectedManagerReservations);
      const courses = await f.repo.listMyConfirmedCourses(MANAGER_EMAIL);
      assert.deepEqual(canonicalManagerCourses(courses), canonicalManagerCourses(expectedManagerCourses));
      noStorageFields(courses); noStorageFields(await f.repo.listMyActiveReservations(MANAGER_EMAIL));
      assert.equal(courses.flatMap(course => course.coaches).filter(coach => coach.engagementId === ids.cross).length, 1);
      assert.ok(!JSON.stringify(courses).includes("Other private review"));
    });

    await suite.test("reservation email is exact including case/whitespace; roster email alone is normalized", async () => {
      const f = await fixture();
      assert.deepEqual(await f.repo.listMyActiveReservations(MANAGER_EMAIL.toUpperCase()), [{ coachId: ids.b, coachName: "가상 투입 코치", date: "2099-01-04" }]);
      assert.deepEqual(await f.repo.listMyActiveReservations(` ${MANAGER_EMAIL} `), [{ coachId: ids.b, coachName: "가상 투입 코치", date: "2099-01-05" }]);
      const normalizedRosterOnly = expectedManagerCourses.map(course => ({ ...course, coaches: course.coaches.map(coach => coach.engagementId === ids.cross ? { ...coach, coachId: ids.b, coachName: "가상 투입 코치" } : coach) }));
      for (const email of [MANAGER_EMAIL.toUpperCase(), ` ${MANAGER_EMAIL} `]) {
        assert.deepEqual(canonicalManagerCourses(await f.repo.listMyConfirmedCourses(email)), canonicalManagerCourses(normalizedRosterOnly));
      }
      assert.deepEqual(await f.repo.listMyActiveReservations(" "), []);
      assert.deepEqual(await f.repo.listMyConfirmedCourses(" "), []);
      assert.deepEqual(await f.repo.listMyActiveReservations("absent@example.invalid"), []);
      assert.deepEqual(await f.repo.listMyConfirmedCourses("absent@example.invalid"), []);
    });

    await suite.test("empty email does not query Mongo and another manager sees only their own data", async () => {
      const f = await fixture(), commands: string[] = [];
      const listener = (event: CommandStartedEvent) => { commands.push(event.commandName); };
      client.on("commandStarted", listener);
      try {
        assert.deepEqual(await f.repo.listMyActiveReservations(""), []);
        assert.deepEqual(await f.repo.listMyConfirmedCourses(""), []);
      } finally { client.off("commandStarted", listener); }
      assert.deepEqual(commands, []);
      assert.deepEqual(await f.repo.listMyActiveReservations(OTHER_MANAGER_EMAIL), [{ coachId: ids.other, coachName: "가상 다른 코치", date: "2099-01-06" }]);
      const other = await f.repo.listMyConfirmedCourses(OTHER_MANAGER_EMAIL);
      assert.deepEqual(other, [{ courseName: "Other manager only", startDate: "2099-04-01", endDate: "2099-04-30", coaches: [{ coachId: ids.other, coachName: "가상 다른 코치", engagementId: ids.otherEngagement, startDate: "2099-04-01", endDate: "2099-04-30", statusLabel: "완료", rating: null, feedback: "Other private review", rehire: null, rounds: [] }] }]);
      noStorageFields(other);
    });

    await suite.test("newest normalized-email roster wins regardless of role; case-sensitive prefilter retains baseline false negatives", async () => {
      const f = await fixture();
      for (const role of ["LD", null]) {
        await f.replace("TeamUser", ids.roster, { role });
        const courses = await f.repo.listMyConfirmedCourses(MANAGER_EMAIL);
        assert.deepEqual(canonicalManagerCourses(courses), canonicalManagerCourses(expectedManagerCourses));
        const found = courses.flatMap(course => course.coaches.map(coach => coach.engagementId));
        for (const id of [ids.substring, ids.caseOnly, ids.whitespaceOnly, ids.oldName, ids.nullName]) assert.ok(!found.includes(id));
      }
      await f.replace("TeamUser", ids.oldRoster, { createdAt: managerDay("2100-01-01") });
      const found = (await f.repo.listMyConfirmedCourses(MANAGER_EMAIL)).flatMap(course => course.coaches.map(coach => coach.engagementId));
      assert.deepEqual(found.slice().sort(), [ids.cross, ids.cancelled, ids.oldName].sort());
    });

    await suite.test("same-name roster ambiguity preserves legacy name-based visibility without a new ownership rule", async () => {
      const f = await fixture();
      await f.replace("TeamUser", ids.otherRoster, { name: MANAGER_NAME });
      const courses = await f.repo.listMyConfirmedCourses(OTHER_MANAGER_EMAIL);
      const expectedNamed = expectedManagerCourses.map(course => ({ ...course, coaches: course.coaches.map(coach => coach.engagementId === ids.cross ? { ...coach, coachId: ids.b, coachName: "가상 투입 코치" } : coach) }));
      assert.deepEqual(canonicalManagerCourses(courses.filter(course => course.courseName !== "Other manager only")), canonicalManagerCourses(expectedNamed));
      assert.equal(courses.length, 4);
      assert.deepEqual(await f.repo.listMyActiveReservations(OTHER_MANAGER_EMAIL), [{ coachId: ids.other, coachName: "가상 다른 코치", date: "2099-01-06" }]);
    });

    await suite.test("null confirmed links are excluded, dangling links fail closed and valid links ignore cancellation", async () => {
      const f = await fixture();
      const dangling = await f.insert("CoachDayReservation", { coachId: ids.a, date: managerDay("2099-03-01"), reservedByEmail: MANAGER_EMAIL, reservedByName: MANAGER_NAME, confirmedEngagementId: randomUUID(), cancelledAt: managerDay("2098-01-01") });
      await assert.rejects(f.repo.listMyConfirmedCourses(MANAGER_EMAIL), error => (error as { code?: string }).code === "MANAGER_MY_PAGE_ENGAGEMENT_NOT_FOUND");
      await f.replace("CoachDayReservation", dangling.id as string, { confirmedEngagementId: null });
      assert.deepEqual(canonicalManagerCourses(await f.repo.listMyConfirmedCourses(MANAGER_EMAIL)), canonicalManagerCourses(expectedManagerCourses));
      // Remove name fallback and duplicate link: an uncancelled confirmed reservation remains sufficient.
      await f.replace("CoachEngagement", ids.cross, { hiredByText: null });
      await f.replace("CoachDayReservation", ids.duplicate, { confirmedEngagementId: null });
      assert.ok((await f.repo.listMyConfirmedCourses(MANAGER_EMAIL)).some(course => course.coaches.some(coach => coach.engagementId === ids.cross && coach.coachId === ids.a)));
    });

    await suite.test("stored identity/review fields are encrypted and read methods issue no writes", async () => {
      const f = await fixture();
      for (const [model, fields] of [["Coach", ["name"]], ["TeamUser", ["name", "email", "slackId"]], ["CoachDayReservation", ["reservedByEmail", "reservedByName"]], ["CoachEngagement", ["hiredByText", "feedback"]]] as const) {
        for (const row of await f.store.collection(model).find({}).toArray()) for (const field of fields) if (row[field] !== null) assert.ok(isEncrypted(row[field]), `${model}.${field}`);
      }
      const commands: string[] = [];
      const listener = (event: CommandStartedEvent) => { commands.push(event.commandName); };
      client.on("commandStarted", listener);
      try { await f.repo.listMyActiveReservations(MANAGER_EMAIL); await f.repo.listMyConfirmedCourses(MANAGER_EMAIL); }
      finally { client.off("commandStarted", listener); }
      assert.ok(commands.every(name => ["find", "getMore", "killCursors", "commitTransaction", "abortTransaction"].includes(name)), commands.join(","));
    });

    await suite.test("all five models paginate beyond 101 without dropped rows or getMore", async () => {
      const f = await fixture();
      const data = new Map<string, MongoRow[]>(models.map(model => [model, []]));
      for (let n = 0; n < 125; n++) {
        const coachId = managerFixtureId(1000 + n), engagementId = managerFixtureId(2000 + n);
        data.get("Coach")!.push(coachFixtureRow("Coach", { id: coachId, name: `Synthetic paged coach ${n}`, normalizedName: `Synthetic paged coach ${n}` }));
        data.get("TeamUser")!.push(coachFixtureRow("TeamUser", { email: `unrelated-${n}@example.invalid`, name: `Other ${n}`, createdAt: managerDay("2100-01-01") }));
        data.get("CoachEngagement")!.push(coachFixtureRow("CoachEngagement", { id: engagementId, coachId, courseName: "Paged synthetic course", hiredByText: MANAGER_NAME, status: "SCHEDULED", startDate: managerDay("2099-05-01"), endDate: managerDay("2099-05-30") }));
        data.get("CoachDayReservation")!.push(coachFixtureRow("CoachDayReservation", { coachId, date: managerDay("2099-05-01"), reservedByEmail: MANAGER_EMAIL, reservedByName: MANAGER_NAME, confirmedEngagementId: engagementId }));
        data.get("CoachEngagementSchedule")!.push(coachFixtureRow("CoachEngagementSchedule", { coachId, engagementId, date: managerDay("2099-05-10"), startTime: "09:00", endTime: "18:00" }));
      }
      for (const [model, rows] of data) await f.store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
      const counts = new Map<string, number>(); let getMore = 0;
      const listener = (event: CommandStartedEvent) => {
        if (event.databaseName !== databaseName) return;
        if (event.commandName === "getMore") getMore++;
        if (event.commandName === "find") counts.set(event.command.find, (counts.get(event.command.find) ?? 0) + 1);
      };
      client.on("commandStarted", listener);
      try {
        const reservations = await f.repo.listMyActiveReservations(MANAGER_EMAIL);
        assert.equal(reservations.length, 128);
        const courses = await f.repo.listMyConfirmedCourses(MANAGER_EMAIL);
        assert.equal(courses.length, 4);
        const paged = courses.find(course => course.courseName === "Paged synthetic course"); assert.ok(paged);
        assert.equal(paged.coaches.length, 125); assert.equal(new Set(paged.coaches.map(coach => coach.engagementId)).size, 125);
        assert.ok(paged.coaches.every(coach => coach.rounds.length === 1));
        assert.deepEqual(canonicalManagerCourses(courses.filter(course => course !== paged)), canonicalManagerCourses(expectedManagerCourses));
      } finally { client.off("commandStarted", listener); }
      assert.equal(getMore, 0);
      for (const model of models) assert.ok((counts.get(`${f.options.namespace}_${model}`) ?? 0) > 1, `${model} must span pages`);
    });

    await suite.test("one snapshot spans reservation, roster, coach, engagement and schedule reads", async () => {
      const f = await fixture(), held = signal(), release = signal();
      const original = MongoOperationStore.prototype.scan;
      let paused = false;
      const patch = mock.method(MongoOperationStore.prototype, "scan", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["scan"]>) {
        const rows = await original.apply(this, args);
        if (this.namespace === f.options.namespace && args[0] === "CoachDayReservation" && !paused) {
          assert.ok(args[2]?.inTransaction()); paused = true; held.resolve(); await release.promise;
        }
        return rows;
      });
      const pending = f.repo.listMyConfirmedCourses(MANAGER_EMAIL); void pending.catch(() => {});
      try {
        await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Snapshot barrier was not reached"); })]));
        const writer = client.startSession();
        try {
          await writer.withTransaction(async () => {
            for (const [model, id, values] of [["TeamUser", ids.roster, { name: "New manager name" }], ["Coach", ids.a, { name: "New coach name" }], ["CoachEngagement", ids.cross, { feedback: "New snapshot feedback" }], ["CoachEngagementSchedule", ids.firstSlot, { cancelledAt: managerDay("2099-01-01") }]] as const) {
              const before = await f.store.one(model, { _id: id }, writer); assert.ok(before);
              await f.store.collection(model).replaceOne({ _id: id }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...before, ...values })), { session: writer });
            }
          });
        } finally { await writer.endSession(); }
        release.resolve();
        assert.deepEqual(canonicalManagerCourses(await pending), canonicalManagerCourses(expectedManagerCourses));
      } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); }
      const current = await f.repo.listMyConfirmedCourses(MANAGER_EMAIL);
      assert.equal(current.length, 2);
      const cross = current.flatMap(course => course.coaches).find(coach => coach.engagementId === ids.cross); assert.ok(cross);
      assert.equal(cross.coachName, "New coach name"); assert.equal(cross.feedback, "New snapshot feedback"); assert.equal(cross.rounds.length, 1);
    });

    await suite.test("active reservations keep their own snapshot while a concurrent writer cancels and renames", async () => {
      const f = await fixture(), held = signal(), release = signal();
      const original = MongoOperationStore.prototype.scan;
      let paused = false;
      const patch = mock.method(MongoOperationStore.prototype, "scan", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["scan"]>) {
        const rows = await original.apply(this, args);
        if (this.namespace === f.options.namespace && args[0] === "CoachDayReservation" && !paused) {
          assert.ok(args[2]?.inTransaction()); paused = true; held.resolve(); await release.promise;
        }
        return rows;
      });
      const pending = f.repo.listMyActiveReservations(MANAGER_EMAIL); void pending.catch(() => {});
      try {
        await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Snapshot barrier was not reached"); })]));
        await f.replace("CoachDayReservation", ids.active, { cancelledAt: managerDay("2099-01-01") });
        await f.replace("Coach", ids.a, { name: "Changed active coach" });
        release.resolve();
        assert.deepEqual(await pending, expectedManagerReservations);
      } finally { release.resolve(); await Promise.allSettled([pending]); patch.mock.restore(); }
      assert.deepEqual(await f.repo.listMyActiveReservations(MANAGER_EMAIL), [expectedManagerReservations[0], { ...expectedManagerReservations[2], coachName: "Changed active coach" }]);
    });

    await suite.test("forging another manager reservation email index never returns their row", async () => {
      const f = await fixture();
      const ours = await f.store.collection("CoachDayReservation").findOne({ _id: ids.linked }); assert.ok(ours);
      await f.store.collection("CoachDayReservation").updateOne({ _id: ids.otherReservation }, { $set: { reservedByEmailPiiIndex: ours.reservedByEmailPiiIndex } });
      for (const read of [() => f.repo.listMyActiveReservations(MANAGER_EMAIL), () => f.repo.listMyConfirmedCourses(MANAGER_EMAIL)]) {
        await assert.rejects(read(), error => {
          assert.equal((error as { code?: string }).code, "MANAGER_MY_PAGE_READ_FAILED");
          assert.ok(!String(error).includes(OTHER_MANAGER_EMAIL));
          return true;
        });
      }
    });

    for (const corruption of ["key", "reservation-hmac", "roster-hmac", "ciphertext"] as const) {
      await suite.test(`${corruption} fails closed without plaintext in the error`, async () => {
        const f = await fixture();
        const model = corruption === "reservation-hmac" ? "CoachDayReservation" : corruption === "roster-hmac" ? "TeamUser" : "CoachEngagement";
        const id = corruption === "reservation-hmac" ? ids.linked : corruption === "roster-hmac" ? ids.roster : ids.named;
        const raw = await f.store.collection(model).findOne({ _id: id }); assert.ok(raw);
        const keys = process.env.PII_ENCRYPTION_KEYS!;
        if (corruption === "key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
        else if (corruption === "ciphertext") {
          const parts = (raw.hiredByText as string).split(":"); parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
          await f.store.collection(model).updateOne({ _id: id }, { $set: { hiredByText: parts.join(":") } });
        } else {
          // Keep the queried email index intact so a selected corrupt document is authenticated.
          const field = corruption === "reservation-hmac" ? "reservedByNamePiiIndex" : "namePiiIndex";
          await f.store.collection(model).updateOne({ _id: id }, { $set: { [field]: "0".repeat(64) } });
        }
        try {
          await assert.rejects(f.repo.listMyConfirmedCourses(MANAGER_EMAIL), error => {
            for (const secret of [MANAGER_EMAIL, MANAGER_NAME, "Synthetic private review"]) assert.ok(!String(error).includes(secret));
            return true;
          });
        } finally { process.env.PII_ENCRYPTION_KEYS = keys; await f.store.collection(model).replaceOne({ _id: id }, raw); }
        assert.deepEqual(canonicalManagerCourses(await f.repo.listMyConfirmedCourses(MANAGER_EMAIL)), canonicalManagerCourses(expectedManagerCourses));
      });
    }

    for (const problem of ["collection", "validator", "index"] as const) {
      await suite.test(`unready ${problem} rejects open without repairing schema`, async () => {
        const f = await fixture(), collection = f.store.collection("TeamUser");
        if (problem === "collection") await collection.drop();
        if (problem === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" });
        if (problem === "index") { const name = operationMongoIndexes("TeamUser")[0]?.name; assert.ok(name); await collection.dropIndex(name); }
        const commands: string[] = [], listener = (event: CommandStartedEvent) => { commands.push(event.commandName); };
        client.on("commandStarted", listener);
        try { await assert.rejects(MongoCoachManagerMyPageRepository.open(f.options)); }
        finally { client.off("commandStarted", listener); }
        assert.ok(commands.every(name => ["hello", "listCollections", "listIndexes", "getMore", "killCursors"].includes(name)));
      });
    }

    await suite.test("injected scan timeout after a successful reservation read never returns partial DTOs", async () => {
      const f = await fixture();
      const original = MongoOperationStore.prototype.scan;
      let completedReservations = 0;
      const patch = mock.method(MongoOperationStore.prototype, "scan", async function (this: MongoOperationStore, ...args: Parameters<MongoOperationStore["scan"]>) {
        if (this.namespace === f.options.namespace && args[0] !== "CoachDayReservation") throw new MongoOperationError("SCAN_TIMEOUT");
        const rows = await original.apply(this, args);
        if (this.namespace === f.options.namespace) { assert.ok(rows.length); completedReservations++; }
        return rows;
      });
      try {
        for (const read of [() => f.repo.listMyActiveReservations(MANAGER_EMAIL), () => f.repo.listMyConfirmedCourses(MANAGER_EMAIL)]) {
          await assert.rejects(read(), error => {
            assert.equal((error as { code?: string }).code, "SCAN_TIMEOUT");
            for (const secret of [MANAGER_EMAIL, MANAGER_NAME]) assert.ok(!String(error).includes(secret));
            return true;
          });
        }
        assert.equal(completedReservations, 2);
      } finally { patch.mock.restore(); }
    });

    await suite.test("oversized decrypted candidate scan fails instead of returning partial courses", async () => {
      const f = await fixture();
      for (let n = 0; n < 3; n++) await f.insert("CoachEngagement", { coachId: ids.a, courseName: "Synthetic oversized candidates", hiredByText: MANAGER_NAME, startDate: managerDay("2099-01-01"), endDate: managerDay("2099-01-02"), feedback: "x".repeat(9 * 1024 * 1024) });
      await assert.rejects(f.repo.listMyConfirmedCourses(MANAGER_EMAIL), error => (error as { code?: string }).code === "SCAN_LIMIT_EXCEEDED");
    });
  } finally {
    try { if (connected) { assert.match(databaseName, /^hub_om_shadow_manager_page_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
    finally { try { await client.close(); } finally { for (const name of envNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } } }
  }
});
