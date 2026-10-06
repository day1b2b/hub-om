import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";
import ts from "typescript";
import { MongoClient } from "mongodb";
import { MongoCoachManagerMyPageRepository, prepareMongoCoachManagerMyPageStore, COACH_MANAGER_MY_PAGE_MODELS } from "./mongoCoachManagerMyPageRepository";
import { MongoOperationStore } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { getCoachManagerMyPageRepository } from "./coachManagerMyPageRepositoryFactory";
import { PrismaCoachManagerMyPageRepository } from "./prismaCoachManagerMyPageRepository";
import type { CoachManagerMyPageRepository } from "./coachManagerMyPageRepository";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const a: Session = { user: { email: "manager-a@day1company.co.kr", name: "Synthetic manager A" }, expires: "" };
const b: Session = { user: { email: "manager-b@day1company.co.kr", name: "Synthetic manager B" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/features/coaches/CoachMyPage") return { url: "data:text/javascript,export const CoachMyPage=()=>null;", shortCircuit: true };
    return next(specifier === "next/navigation" ? "next/navigation.js" : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
const { default: page } = await import("../../app/coaches/my-page/page");
hooks.deregister();

test("manager my-page factory defaults to PG and isolates nested/concurrent contexts", async () => {
  assert.ok(getCoachManagerMyPageRepository() instanceof PrismaCoachManagerMyPageRepository);
  const first = {} as CoachManagerMyPageRepository, second = {} as CoachManagerMyPageRepository;
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const pending = runWithDataRepositories({ coachManagerMyPage: first }, async () => {
    await barrier; assert.equal(getCoachManagerMyPageRepository(), first);
    await assert.rejects(runWithDataRepositories({ coachManagerMyPage: second }, async () => { assert.equal(getCoachManagerMyPageRepository(), second); throw new Error("Synthetic nested failure"); }));
    assert.equal(getCoachManagerMyPageRepository(), first);
  });
  await runWithDataRepositories({ coachManagerMyPage: second }, async () => { release(); await pending; assert.equal(getCoachManagerMyPageRepository(), second); });
  runWithDataRepositories({}, () => assert.throws(getCoachManagerMyPageRepository, /DATA_REPOSITORY_NOT_CONFIGURED: coachManagerMyPage/));
  assert.ok(getCoachManagerMyPageRepository() instanceof PrismaCoachManagerMyPageRepository);
});

const uri = process.env.MONGODB_MANAGER_MY_PAGE_TEST_URI;
test("actual manager my-page uses only the admin session email in native Mongo scope", { skip: !uri, timeout: 120_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "DATABASE_URL"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: `${a.user.email},${b.user.email}` });
  delete process.env.DEV_AUTH_BYPASS; delete process.env.DATABASE_URL;
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_manager_page_${randomBytes(8).toString("hex")}`;
  let connected = false;
  try {
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace: "shadow_page", allowShadowWrites: true as const };
    await prepareMongoCoachManagerMyPageStore(options);
    const store = new MongoOperationStore(options, COACH_MANAGER_MY_PAGE_MODELS), repo = await MongoCoachManagerMyPageRepository.open(options);
    const coachId = randomUUID();
    await store.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", coachFixtureRow("Coach", { id: coachId, name: "가상 페이지 코치", deletedAt: new Date("2000-01-01") })));
    for (const [index, actor] of [a, b].entries()) {
      await store.collection("TeamUser").insertOne(encodeMongoRuntimeDocument("TeamUser", coachFixtureRow("TeamUser", { email: actor.user.email, name: actor.user.name })));
      await store.collection("CoachDayReservation").insertOne(encodeMongoRuntimeDocument("CoachDayReservation", coachFixtureRow("CoachDayReservation", { coachId, reservedByEmail: actor.user.email, date: new Date(`2099-01-0${index + 1}`), cancelledAt: null })));
      for (const past of [false, true]) await store.collection("CoachEngagement").insertOne(encodeMongoRuntimeDocument("CoachEngagement", coachFixtureRow("CoachEngagement", { coachId, courseName: `Synthetic ${index} ${past ? "past" : "future"}`, hiredByText: actor.user.name, startDate: new Date(past ? "2000-01-01" : "2099-01-01"), endDate: new Date(past ? "2000-01-02" : "2099-01-02"), rating: 0, feedback: `Synthetic private ${index}` })));
    }
    const run = (actor: Session | null) => runWithDataRepositories({ coachManagerMyPage: repo }, () => actors.run(actor, () => page()));
    await suite.test("real admin guard denies anonymous, outsiders and ordinary workspace users before reads", async () => {
      for (const actor of [null, { ...a, user: { ...a.user, email: "outsider@example.invalid" } }, { ...a, user: { ...a.user, email: "ordinary@day1company.co.kr" } }]) {
        await assert.rejects(runWithDataRepositories({}, () => actors.run(actor, () => page())), /NEXT_REDIRECT/);
      }
      await assert.rejects(runWithDataRepositories({}, () => actors.run(a, () => page())), /DATA_REPOSITORY_NOT_CONFIGURED: coachManagerMyPage/);
      assert.equal(pgCalls, 0);
    });
    await suite.test("concurrent admins see only their own exact-email reservations and named courses", async () => {
      const output = await Promise.all([run(a), run(b)]);
      for (const [i, result] of output.entries()) {
        assert.deepEqual(result.props.reservations, [{ coachId, coachName: "가상 페이지 코치", date: `2099-01-0${i + 1}` }]);
        assert.equal(result.props.inProgressCourses[0].courseName, `Synthetic ${i} future`);
        assert.equal(result.props.pastCourses[0].courseName, `Synthetic ${i} past`);
        assert.ok(!JSON.stringify(result.props).includes(`Synthetic private ${1 - i}`));
        assert.match(result.props.todayIso, /^\d{4}-\d{2}-\d{2}$/);
      }
    });
    await suite.test("authorized empty account renders empty lists without choosing a different identity", async () => {
      const empty = { ...a, user: { email: "empty-manager@day1company.co.kr", name: "Synthetic empty" } };
      process.env.ADMIN_EMAILS += `,${empty.user.email}`;
      const result = await run(empty);
      assert.deepEqual(result.props.reservations, []); assert.deepEqual(result.props.inProgressCourses, []); assert.deepEqual(result.props.pastCourses, []);
    });
    await suite.test("search parameters cannot replace the authenticated manager identity", async () => {
      const output = await runWithDataRepositories({ coachManagerMyPage: repo }, () => actors.run(a, () =>
        Reflect.apply(page, undefined, [{ searchParams: Promise.resolve({ email: b.user.email, manager: b.user.name }) }]) as ReturnType<typeof page>));
      assert.deepEqual(output.props.reservations.map((row: { date: string }) => row.date), ["2099-01-01"]);
      assert.equal(output.props.inProgressCourses[0].courseName, "Synthetic 0 future");
    });
    const raw = JSON.stringify(await Promise.all(store.models.map(model => store.collection(model).find({}).toArray())));
    for (const value of [a.user.email, b.user.email, a.user.name, b.user.name, "가상 페이지 코치", "Synthetic private"]) assert.ok(!raw.includes(value));
    assert.equal(pgCalls, 0);
  } finally {
    if (connected) await client.db(databaseName).dropDatabase(); await client.close();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
