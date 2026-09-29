import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import { MongoClient } from "mongodb";
import { getPrismaClient } from "./prisma";
import { PrismaCoachManagerMyPageRepository } from "./prismaCoachManagerMyPageRepository";
import { MongoCoachManagerMyPageRepository, prepareMongoCoachManagerMyPageStore, COACH_MANAGER_MY_PAGE_MODELS } from "./mongoCoachManagerMyPageRepository";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { coachManagerMyPageFixtures, expectedManagerReservations, expectedManagerCourses, MANAGER_EMAIL, OTHER_MANAGER_EMAIL, MY_PAGE_IDS, managerFixtureId, managerDay } from "./coachManagerMyPageFixtures";
import { partitionConfirmedCourses } from "./coachMyPagePresentation";
import { resolveOmNameByEmail } from "./myOperations";
import type { MyActiveReservation, MyConfirmedCourse, MyConfirmedCourseCoach } from "./coachManagerMyPageRepository";

const url = process.env.COACH_MANAGER_MY_PAGE_PG_TEST_DATABASE_URL;
const uri = process.env.MONGODB_MANAGER_MY_PAGE_TEST_URI;
type Database = ReturnType<typeof getPrismaClient>;
const key = (date: Date) => date.toISOString().slice(0, 10);

/** Frozen predicates and projection/grouping from bc77a12 coachMyPage.ts.
 * This reference intentionally does NOT invoke either adapter or shared presentation/name helpers.
 * It still uses the real privacy-aware PG client, like the original implementation.
 */
async function baselineReservations(db: Database, email: string): Promise<MyActiveReservation[]> {
  if (!email) return [];
  const rows = await db.coachDayReservation.findMany({
    where: { reservedByEmail: email, cancelledAt: null },
    select: { date: true, coach: { select: { id: true, name: true } } },
    orderBy: [{ date: "asc" }]
  });
  return rows.map(row => ({ coachId: row.coach.id, coachName: row.coach.name, date: key(row.date) }));
}
const baselineSelect = { id: true, courseName: true, startDate: true, endDate: true, status: true, rating: true, feedback: true, rehire: true } as const;
const baselineNormalizeName = (name: string) => name.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "").toLowerCase();
async function baselineCourses(db: Database, email: string): Promise<MyConfirmedCourse[]> {
  if (!email) return [];
  const reservations = await db.coachDayReservation.findMany({
    where: { reservedByEmail: email, confirmedEngagementId: { not: null } },
    select: { coach: { select: { id: true, name: true } }, confirmedEngagement: { select: baselineSelect } }
  });
  type Linked = { coach: { id: string; name: string }; engagement: NonNullable<(typeof reservations)[number]["confirmedEngagement"]> };
  const linked = new Map<string, Linked>();
  for (const row of reservations) if (row.confirmedEngagement) linked.set(row.confirmedEngagement.id, { coach: row.coach, engagement: row.confirmedEngagement });
  const normalizedEmail = email.trim().toLowerCase();
  const roster = normalizedEmail ? await db.teamUser.findMany({ orderBy: { createdAt: "desc" } }) : [];
  const myName = roster.find(row => row.email.trim().toLowerCase() === normalizedEmail)?.name ?? null;
  if (myName) {
    const candidates = await db.coachEngagement.findMany({
      where: { hiredByText: { contains: myName } },
      select: { ...baselineSelect, hiredByText: true, coach: { select: { id: true, name: true } } }
    });
    for (const candidate of candidates) {
      if (linked.has(candidate.id)) continue;
      const parts = (candidate.hiredByText ?? "").split(/[,，、/]+/).map(name => name.trim()).filter(Boolean);
      const names = parts.length ? [...new Set(parts)] : ["배정필요"];
      if (names.some(name => baselineNormalizeName(name) === baselineNormalizeName(myName))) linked.set(candidate.id, { coach: candidate.coach, engagement: candidate });
    }
  }
  const ids = [...linked.keys()];
  const slots = ids.length ? await db.coachEngagementSchedule.findMany({
    where: { engagementId: { in: ids }, cancelledAt: null },
    select: { engagementId: true, date: true, startTime: true, endTime: true },
    orderBy: [{ date: "asc" }]
  }) : [];
  const groups = new Map<string, MyConfirmedCourse>();
  const labels = { SCHEDULED: "예정", IN_PROGRESS: "진행", COMPLETED: "완료", CANCELLED: "취소" };
  for (const { coach, engagement: row } of linked.values()) {
    const startDate = key(row.startDate), endDate = key(row.endDate);
    let group = groups.get(row.courseName);
    if (!group) { group = { courseName: row.courseName, startDate, endDate, coaches: [] }; groups.set(row.courseName, group); }
    else { if (startDate < group.startDate) group.startDate = startDate; if (endDate > group.endDate) group.endDate = endDate; }
    if (!group.coaches.some(coach => coach.engagementId === row.id)) group.coaches.push({
      coachId: coach.id, coachName: coach.name, engagementId: row.id, startDate, endDate,
      statusLabel: labels[row.status], rating: row.rating, feedback: row.feedback, rehire: row.rehire,
      rounds: slots.filter(slot => slot.engagementId === row.id).map(slot => ({ date: key(slot.date), startTime: slot.startTime, endTime: slot.endTime }))
    });
  }
  return [...groups.values()].sort((a, b) => b.endDate.localeCompare(a.endDate));
}
// Coach encounter order is not specified by the original unsorted reservation/candidate queries.
// Do not normalize outer course order or rounds here: fixed fixtures have distinct sort dates.
const canonical = (rows: MyConfirmedCourse[]) => rows.map(row => ({ ...row, coaches: [...row.coaches].sort((a, b) => a.engagementId.localeCompare(b.engagementId)) }));

/** Destructive setup is strictly opt-in and limited to the named disposable PG database.
 * Runner: env -i HOME=/Users/ga /bin/bash /private/tmp/hub-om-manager-20260929/run.sh manager
 * No production URLs, .env loading, token backfill, real users or non-owned Mongo cleanup.
 */
test("manager my-page PostgreSQL migrations and frozen bc77a12 baseline match Mongo on the shared synthetic fixture", { skip: !url || !uri, timeout: 240_000 }, async suite => {
  const p = new URL(url!), m = new URL(uri!);
  assert.ok(["postgres:", "postgresql:"].includes(p.protocol)); assert.equal(p.hostname, "127.0.0.1"); assert.equal(p.pathname, "/manager_my_page_parity");
  assert.equal(p.username, "synthetic"); assert.equal(p.password, ""); assert.ok(p.port); assert.equal(p.search, "");
  assert.equal(m.protocol, "mongodb:"); assert.equal(m.hostname, "127.0.0.1"); assert.ok(m.port); assert.equal(m.pathname, "/"); assert.equal(m.username, ""); assert.equal(m.password, "");
  assert.deepEqual([...m.searchParams.keys()], ["replicaSet"]); assert.ok(m.searchParams.get("replicaSet"));
  const envNames = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: url });
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_manager_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_manager_parity", namespace, allowShadowWrites: true as const };
  let db: Database | undefined, sqlConnected = false, mongoConnected = false;
  try {
    await client.connect(); mongoConnected = true;
    assert.equal((await client.db("admin").command({ hello: 1 })).isWritablePrimary, true);
    await sql.connect(); sqlConnected = true;
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const migrationRoot = path.resolve("prisma/migrations");
    const migrations = readdirSync(migrationRoot, { withFileTypes: true }).filter(row => row.isDirectory()).map(row => row.name).sort();
    for (const migration of migrations) await sql.query(readFileSync(path.join(migrationRoot, migration, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient();
    const pgDb = db;
    const delegates = pgDb as unknown as Record<string, { createMany(args: { data: MongoRow[] }): Promise<unknown> }>;
    await prepareMongoCoachManagerMyPageStore(options);
    const store = new MongoOperationStore(options, COACH_MANAGER_MY_PAGE_MODELS);
    const fixture = coachManagerMyPageFixtures();
    const seed = async (model: string, rows: MongoRow[]) => {
      await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: rows });
      await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    };
    for (const [model, rows] of fixture) await seed(model, rows);
    const pgRepo = new PrismaCoachManagerMyPageRepository(), mongoRepo = await MongoCoachManagerMyPageRepository.open(options);
    const snapshot = async () => {
      const hashes: string[] = [];
      for (const table of ["coaches", "coach_day_reservations", "coach_engagements", "coach_engagement_schedules", "team_users", "activity_changes"]) {
        const result = await sql.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`);
        hashes.push(createHash("sha256").update(JSON.stringify(result.rows)).digest("hex"));
      }
      for (const model of COACH_MANAGER_MY_PAGE_MODELS) hashes.push(createHash("sha256").update(JSON.stringify(await store.collection(model).find({}).sort({ _id: 1 }).toArray())).digest("hex"));
      return hashes;
    };
    const beforeReads = await snapshot();
    console.log(`[manager-pg-parity] migrations=${migrations.length} models=${fixture.size} source=bc77a12`);

    await suite.test("exact reservation email, active cancellation, normalized duplicate roster first match and case-sensitive hired text", async () => {
      assert.equal(await resolveOmNameByEmail(MANAGER_EMAIL), "Alex Owner");
      // Newest matching row is LD, not OM: the legacy resolver has no role filter.
      const expectedNormal = expectedManagerReservations;
      const variants: Array<[string, MyActiveReservation[]]> = [
        [MANAGER_EMAIL, expectedNormal],
        [MANAGER_EMAIL.toUpperCase(), [{ coachId: MY_PAGE_IDS.b, coachName: "가상 투입 코치", date: "2099-01-04" }]],
        [` ${MANAGER_EMAIL} `, [{ coachId: MY_PAGE_IDS.b, coachName: "가상 투입 코치", date: "2099-01-05" }]],
        ["", []], ["   ", []], ["missing@example.invalid", []]
      ];
      for (const [email, expected] of variants) {
        assert.deepEqual(await baselineReservations(pgDb, email), expected);
        assert.deepEqual(await pgRepo.listMyActiveReservations(email), expected);
        assert.deepEqual(await mongoRepo.listMyActiveReservations(email), expected);
      }
      for (const email of [MANAGER_EMAIL, MANAGER_EMAIL.toUpperCase(), ` ${MANAGER_EMAIL} `]) {
        // Alternate spellings match the same roster but NOT the original reservation links.
        const expected = expectedManagerCourses.map(course => ({ ...course, coaches: course.coaches.map(coach =>
          email !== MANAGER_EMAIL && coach.engagementId === MY_PAGE_IDS.cross ? { ...coach, coachId: MY_PAGE_IDS.b, coachName: "가상 투입 코치" } : coach) }));
        assert.deepEqual(canonical(await baselineCourses(pgDb, email)), canonical(expected));
        assert.deepEqual(canonical(await pgRepo.listMyConfirmedCourses(email)), canonical(expected));
        assert.deepEqual(canonical(await mongoRepo.listMyConfirmedCourses(email)), canonical(expected));
      }
      for (const repo of [pgRepo, mongoRepo]) for (const email of ["", "   ", "missing@example.invalid"]) assert.deepEqual(await repo.listMyConfirmedCourses(email), []);
    });

    await suite.test("fixed DTOs preserve cancelled confirmation links, cross-coach owner, deleted coach, slots, grouping and all status labels", async () => {
      const original = await baselineCourses(pgDb, MANAGER_EMAIL);
      assert.deepEqual(canonical(original), canonical(expectedManagerCourses));
      for (const repo of [pgRepo, mongoRepo]) {
        const actual = await repo.listMyConfirmedCourses(MANAGER_EMAIL);
        assert.deepEqual(canonical(actual), canonical(expectedManagerCourses));
        const flat = actual.flatMap(course => course.coaches);
        assert.deepEqual(new Set(flat.map(row => row.engagementId)), new Set([MY_PAGE_IDS.cross, MY_PAGE_IDS.named, MY_PAGE_IDS.completed, MY_PAGE_IDS.cancelled]));
        assert.deepEqual(new Set(flat.map(row => row.statusLabel)), new Set(["예정", "진행", "완료", "취소"]));
        const cross = flat.find(row => row.engagementId === MY_PAGE_IDS.cross)!;
        assert.equal(cross.coachId, MY_PAGE_IDS.a); assert.equal(cross.rating, 0); assert.equal(cross.feedback, ""); assert.equal(cross.rehire, false);
        assert.deepEqual(cross.rounds.map(row => row.date), ["2099-01-12", "2099-01-18"]);
        const shared = actual.find(row => row.courseName === "Shared synthetic course")!;
        assert.equal(shared.startDate, "2099-01-05"); assert.equal(shared.endDate, "2099-01-25");
        assert.equal(shared.coaches.find(row => row.engagementId === MY_PAGE_IDS.named)!.rounds[0].date, "2099-01-30", "course bounds use engagements, not slot extremes");
        assert.ok(flat.some(row => row.coachId === MY_PAGE_IDS.deleted));
        const other = await repo.listMyConfirmedCourses(OTHER_MANAGER_EMAIL);
        assert.deepEqual(other.map(row => row.courseName), ["Other manager only"]);
        assert.equal(other[0].coaches[0].engagementId, MY_PAGE_IDS.otherEngagement);
      }
    });

    await suite.test("partition uses course end date, includes today and preserves independent fixed expectations", async () => {
      for (const repo of [pgRepo, mongoRepo]) {
        const courses = await repo.listMyConfirmedCourses(MANAGER_EMAIL);
        const snapshot = JSON.stringify(courses);
        const partition = partitionConfirmedCourses(courses, "2099-01-25");
        assert.deepEqual(partition.inProgress.map(row => row.courseName), ["Shared synthetic course", "Later synthetic course"]);
        assert.deepEqual(partition.past.map(row => row.courseName), ["Earlier synthetic course"]);
        assert.deepEqual(partitionConfirmedCourses(courses, "2099-01-26").past.map(row => row.courseName), ["Shared synthetic course", "Earlier synthetic course"]);
        assert.deepEqual(partitionConfirmedCourses(courses, "2099-03-01").inProgress, []);
        assert.equal(JSON.stringify(courses), snapshot);
      }
      assert.deepEqual(await snapshot(), beforeReads, "PG/Mongo read calls do not mutate source documents, timestamps, tokens or PG audit rows");
    });

    await suite.test("date ties compare members within tied blocks, never invent an unspecified PG tie-break", async () => {
      // Isolated additions: shared fixture and its distinct-date expected DTOs remain unchanged.
      const email = "synthetic-tie@example.invalid", name = "Tie Manager";
      const e1 = managerFixtureId(810), e2 = managerFixtureId(811), day = managerDay("2100-01-01");
      await seed("TeamUser", [coachFixtureRow("TeamUser", { id: managerFixtureId(800), name, email, createdAt: managerDay("2099-01-01") })]);
      await seed("CoachEngagement", [e1, e2].map((id, index) => coachFixtureRow("CoachEngagement", {
        id, sourceEngagementId: `synthetic-tie-${id}`, coachId: MY_PAGE_IDS.a, courseName: `Tie course ${index}`, startDate: day, endDate: day, status: "SCHEDULED", hiredByText: name
      })));
      await seed("CoachDayReservation", [MY_PAGE_IDS.a, MY_PAGE_IDS.b].map((coachId, index) => coachFixtureRow("CoachDayReservation", {
        id: managerFixtureId(820 + index), coachId, date: day, reservedByEmail: email, reservedByName: name
      })));
      await seed("CoachEngagementSchedule", ["11:00", "09:00"].map((startTime, index) => coachFixtureRow("CoachEngagementSchedule", {
        id: managerFixtureId(830 + index), sourceEngagementScheduleId: `synthetic-tie-slot-${index}`, coachId: MY_PAGE_IDS.b, engagementId: e1, date: day, startTime, endTime: "12:00"
      })));
      const normalizeTies = (courses: MyConfirmedCourse[]) => courses.map(course => ({ ...course,
        coaches: course.coaches.map((coach: MyConfirmedCourseCoach) => ({ ...coach, rounds: [...coach.rounds].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)) })).sort((a, b) => a.engagementId.localeCompare(b.engagementId))
      })).sort((a, b) => b.endDate.localeCompare(a.endDate) || a.courseName.localeCompare(b.courseName));
      const expected = normalizeTies(await baselineCourses(pgDb, email));
      assert.deepEqual(expected.map(row => row.courseName), ["Tie course 0", "Tie course 1"]);
      assert.deepEqual(expected[0].coaches[0].rounds.map(row => row.startTime), ["09:00", "11:00"]);
      const before = await snapshot();
      for (const repo of [pgRepo, mongoRepo]) {
        const reservations = await repo.listMyActiveReservations(email);
        assert.deepEqual(reservations.map(row => row.date), ["2100-01-01", "2100-01-01"]);
        assert.deepEqual(reservations.map(row => row.coachId).sort(), [MY_PAGE_IDS.a, MY_PAGE_IDS.b].sort());
        const courses = await repo.listMyConfirmedCourses(email);
        assert.deepEqual(normalizeTies(courses), expected);
        assert.equal(partitionConfirmedCourses(courses, "2100-01-01").inProgress.length, 2);
        assert.equal(partitionConfirmedCourses(courses, "2100-01-02").past.length, 2);
      }
      assert.deepEqual(await snapshot(), before);
      console.log("[manager-pg-parity] distinct-date fixture strict; tied date blocks compared as members; roster timestamp/cross-coach duplicate ties remain unspecified");
    });
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (sqlConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) {
            assert.match(namespace, /^shadow_manager_pg_[a-f0-9]{16}$/);
            const owned = await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
            for (const collection of owned) {
              assert.ok(collection.name.startsWith(`${namespace}_`));
              await client.db(options.databaseName).collection(collection.name).drop();
            }
          }
        } finally { await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    }
  }
});
