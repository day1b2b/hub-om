/** V2 / V4 isolation / V5 errors. Parent-run only, exact opt-in URI.
 * Node24 --experimental-strip-types --experimental-test-module-mocks
 * --experimental-loader ./scripts/ts-loader.mjs --test THIS_FILE
 * Start env -i. Actual default PG parity, full reader oracle, and transaction
 * retry/ACK schedules belong to other suites. No Sheets fixtures are imported.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, MongoServerError } from "mongodb";
import { runWithDataRepositories, getDataRepositoryOverride, type DataRepositories } from "./dataRepositoryContext";
import { operationMongoValidator } from "./mongoOperationStore";
import { URI, DBPATH, ROUTE, TOKEN, PRIVATE, CANARY, IDS, CONFIG_KEYS, ERR, actor, page, probe, probes, current,
  body, request, setup, raw, success, errorResponse, checkAudit, assertNoLeaks, barrier, bounded, type Native, type Probe } from "./notionImportHandlerNative.fixture";

const uri = process.env.MONGODB_NOTION_IMPORT_TEST_URI;
test("Notion actual handler native auth/config/isolation/error boundaries", { skip: !uri, timeout: 240_000 }, async suite => {
  assert.equal(uri, URI);
  const envKeys = [...CONFIG_KEYS, "DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY",
    "PII_ALLOW_PLAINTEXT_READS", "DEV_AUTH_BYPASS", "DEV_AUTH_EMAIL", "ADMIN_EMAILS", "OPERATION_DATA_SOURCE"];
  for (const name of envKeys) assert.equal(process.env[name], undefined, `Sanitized worker required: inherited ${name}`);
  const savedTZ = process.env.TZ; assert.ok(savedTZ === undefined || savedTZ === "UTC");
  assert.equal((globalThis as { prisma?: unknown }).prisma, undefined);
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ notion: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "notion",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: "",
    OPERATION_DATA_SOURCE: "local", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/notion_tripwire", TZ: "UTC" });
  function config(values: Record<string, string | undefined> = {}) {
    for (const key of CONFIG_KEYS) delete process.env[key];
    process.env.NOTION_TOKEN = TOKEN;
    for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  config();
  let pgCalls = 0, localCalls = 0, otherNotionCalls = 0, forbiddenFetches = 0;
  const logs: unknown[][] = [], tokens = new Set([TOKEN]);
  const httpAttempts: Array<{ input: Parameters<typeof fetch>[0]; init: Parameters<typeof fetch>[1] }> = [];
  const transportViolations: Array<{ attempt: number; stage: string }> = [];
  function assertTransport() {
    assert.deepEqual(transportViolations, [], "HTTP contract violations must not be swallowed by the route catch");
  }
  async function checkedPost(work: () => Promise<Response>) {
    try { return await work(); } finally { assertTransport(); }
  }
  const captures = (["error", "warn", "log", "info", "debug"] as const).map(level => mock.method(console, level, (...args: unknown[]) => { logs.push(args); }));
  const fetchMock = mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    // Record every attempt BEFORE URL, script or options checks. Route catches
    // must not turn a transport-oracle failure into an accepted generic400.
    httpAttempts.push({ input, init });
    const p = probes.getStore();
    const index = p?.httpCalls.length ?? 0;
    p?.httpCalls.push({ url: String(input), init }); p?.events.push(`http:${index + 1}`);
    let stage = "scope";
    try {
      assert.ok(p, "HTTP probe required");
      stage = "url";
      if (input !== `https://api.notion.com/v1/databases/${p.databaseId}/query`) forbiddenFetches++;
      assert.equal(input, `https://api.notion.com/v1/databases/${p.databaseId}/query`);
      stage = "script";
      assert.ok(p.frames[index], "synthetic HTTP script exhausted");
      const previous = index ? p.frames[index - 1].payload as { next_cursor?: unknown } : undefined;
      stage = "options";
      assert.deepEqual(init, { method: "POST", headers: { Authorization: `Bearer ${p.expectedToken}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
        body: JSON.stringify(index ? { page_size: 100, start_cursor: previous?.next_cursor } : { page_size: 100 }), cache: "no-store" });
    } catch {
      transportViolations.push({ attempt: httpAttempts.length, stage });
      throw new Error("NOTION_HTTP_CONTRACT_VIOLATION");
    }
    // Deliberate transport rejection is outside the oracle-validation catch.
    const frame = p.frames[index];
    if (frame.reject) throw frame.reject.value;
    return new Response(frame.malformedJSON ? "{" : JSON.stringify(frame.payload ?? {}),
      { status: frame.status ?? 200, statusText: frame.statusText ?? "", headers: { "content-type": "application/json" } });
  });
  const modules = [
    mock.module("@/auth", { namedExports: { auth: async () => { const p = current(); p.events.push("auth"); return p.session; } } }),
    mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("NOTION_PG_TRIPWIRE"); } } } }),
    mock.module("./localJsonTeamMemberRepository", { namedExports: { LocalJsonTeamMemberRepository: class { constructor() { localCalls++; throw new Error("LOCAL_TRIPWIRE"); } } } }),
    mock.module("./localJsonInstructorNoteRepository", { namedExports: { LocalJsonInstructorNoteRepository: class { constructor() { localCalls++; throw new Error("LOCAL_TRIPWIRE"); } } } }),
    mock.module("./notionTeamMemberRepository", { namedExports: { getNotionTeamMemberRepository: () => { otherNotionCalls++; throw new Error("OTHER_NOTION_TRIPWIRE"); } } })
  ];
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context);
  } });
  const client = new MongoClient(URI, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  try {
    const { POST } = await import("../../app/api/admin/imports/notion/import/route");
    const { getPrismaClient } = await import("./prisma");
    assert.throws(() => getPrismaClient(), /NOTION_PG_TRIPWIRE/); assert.equal(pgCalls, 1); pgCalls = 0;
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.setName, "notionimport20260930"); assert.deepEqual(hello.hosts, ["127.0.0.1:27852"]);
    assert.equal((await client.db("admin").command({ getCmdLineOpts: 1 })).parsed?.storage?.dbPath, DBPATH);
    let seq = 0;
    const nextBody = () => body(`request-${++seq}`);
    function noFallback() { assertTransport(); assert.deepEqual({ pgCalls, localCalls, otherNotionCalls, forbiddenFetches }, { pgCalls: 0, localCalls: 0, otherNotionCalls: 0, forbiddenFetches: 0 }); }
    function invoke(a: Native, p: Probe, input: unknown = nextBody(), scope: Partial<DataRepositories> = a.scope, authorization = false, rawJSON?: string) {
      return checkedPost(() => probes.run(p, () => runWithDataRepositories(scope, () => POST(request(input, authorization, rawJSON)))));
    }
    async function audit(a: Native, response: Response, p: Probe, authorization = false) {
      await checkAudit(a, response.headers.get("X-Request-Id"), response.status, p, authorization); noFallback();
    }
    async function rejected(a: Native, p: Probe, expected: string, input: unknown = nextBody(), scope: Partial<DataRepositories> = a.scope, rawJSON?: string) {
      const before = await raw(a.store), response = await invoke(a, p, input, scope, false, rawJSON);
      await errorResponse(response, expected); await audit(a, response, p); assert.equal(await raw(a.store), before);
      assert.ok(!p.events.includes("store:done")); return p;
    }
    function noBusiness(p: Probe) {
      assert.deepEqual(p.sourceCalls, []); assert.deepEqual(p.httpCalls, []);
      assert.ok(!p.events.some(event => event.startsWith("store:") || event.startsWith("roster:")));
    }
    async function scenario(name: string, work: (a: Native, b?: Native) => Promise<void>, pair = false) {
      await suite.test(name, async () => {
        config(); const owned: string[] = [], natives: Native[] = [];
        try {
          for (const suffix of pair ? ["a", "b"] : ["a"]) {
            const name = `hub_om_shadow_notion_handlers_${randomBytes(8).toString("hex")}_${suffix}`;
            assert.equal((await client.db(name).listCollections({}, { nameOnly: true }).toArray()).length, 0);
            owned.push(name); natives.push(await setup(client, name, suffix));
          }
          await work(natives[0], natives[1]);
          for (const a of natives) {
            await a.assertSentinel();
            const collections = await a.store.db.listCollections({}, { nameOnly: true }).toArray();
            const stored = await Promise.all(collections.map(item => a.store.db.collection(item.name).find({}).toArray()));
            assertNoLeaks(stored, [PRIVATE, CANARY, ...tokens]);
            for (const model of a.store.models) assertNoLeaks(await a.store.scan(model), [CANARY, ...tokens]);
            for (const run of await a.store.collection("DataImportRun").find({}).toArray()) {
              assert.match(String(run.sourceName), /^pii:v1:notion:/); assert.match(String(run.importedBy), /^pii:v1:notion:/);
              assert.ok(typeof run.sourceNamePiiIndex === "string" && run.sourceNamePiiIndex.length > 0);
            }
          }
          assertNoLeaks(logs, [PRIVATE, CANARY, ...tokens]); noFallback();
        } finally {
          for (const native of natives) native.restore();
          const cleanup = await Promise.allSettled(owned.map(async name => {
            await client.db(name).dropDatabase();
            assert.equal((await client.db(name).listCollections({}, { nameOnly: true }).toArray()).length, 0);
          }));
          config(); for (const result of cleanup) if (result.status === "rejected") throw result.reason;
          assertTransport();
        }
      });
    }

    await scenario("actual guard/session/Authorization matrix; Google/body/header tokens cannot authenticate or replace server token", async a => {
      for (const authorization of [false, true]) {
        const p = probe(), response = await invoke(a, p, nextBody(), a.scope, authorization), id = await success(response);
        assert.equal(p.events.filter(event => event === "auth").length, authorization ? 1 : 2);
        assert.equal(p.sourceCalls[0].token, TOKEN); assert.equal(p.sourceCalls.length, 1);
        assert.equal((await a.store.one("DataImportRun", { _id: id }))?.importedBy, actor().user.email);
        assert.deepEqual(p.events, [...Array(authorization ? 1 : 2).fill("auth"), "source:start", "http:1", "source:done", "store:start",
          "roster:members", "roster:instructors", "store:done", "audit:start", "audit:done"]);
        await audit(a, response, p, authorization);
        for (const session of [null, { ...actor(), user: { email: "outsider@example.invalid", name: "Synthetic outsider" } }]) {
          config({ NOTION_TOKEN: undefined }); const denied = probe("a", session), before = await raw(a.store);
          const ids = new Set((await a.store.scan("ActivityRequest")).map(row => row.id));
          await assert.rejects(invoke(a, denied, {}, a.scope, authorization, "{"), (error: unknown) => {
            assert.ok(error instanceof Error && "digest" in error); assert.equal(error.digest, "NEXT_REDIRECT;replace;/sign-in;307;"); return true;
          });
          const added = (await a.store.scan("ActivityRequest")).filter(row => !ids.has(row.id)); assert.equal(added.length, 1);
          await checkAudit(a, String(added[0].id), 307, denied, authorization); noBusiness(denied);
          assert.equal(denied.events.filter(event => event === "auth").length, authorization ? 1 : 2);
          assert.equal(await raw(a.store), before); config();
        }
      }
    });

    await scenario("serial server token nullish precedence, empty/whitespace and JSON priority", async a => {
      for (const item of [
        { env: { NOTION_TOKEN: TOKEN, NOTION_API_KEY: "synthetic-secondary-token" }, token: TOKEN },
        { env: { NOTION_TOKEN: undefined, NOTION_API_KEY: "synthetic-api-key-token" }, token: "synthetic-api-key-token" },
        { env: { NOTION_TOKEN: "   ", NOTION_API_KEY: "synthetic-secondary-token" }, token: "   " }
      ]) {
        config(item.env); const p = probe(); p.expectedToken = item.token;
        // Whitespace is not a secret marker; its exact forwarding is asserted by transport.
        if (item.token.trim()) tokens.add(item.token);
        const response = await invoke(a, p), id = await success(response); assert.ok(id);
        assert.equal(p.sourceCalls[0].token, item.token); await audit(a, response, p);
      }
      for (const values of [{ NOTION_TOKEN: undefined }, { NOTION_TOKEN: "", NOTION_API_KEY: "synthetic-api-key-token" }]) {
        config(values);
        for (const authorization of [false, true]) {
          const p = probe(), before = await raw(a.store);
          const response = await invoke(a, p, { token: TOKEN }, { requestActivity: a.scope.requestActivity }, authorization, "{");
          await errorResponse(response, ERR.token); await audit(a, response, p, authorization); noBusiness(p);
          assert.equal(await raw(a.store), before);
        }
      }
    });

    await scenario("serial URL/team alias/fallback matrix preserves short circuit and untrimmed env IDs", async a => {
      const matrix = [
        { input: { databaseUrl: ` ${IDS[0]} `, notionUrl: 123 }, env: {}, selected: IDS[0], team: "UNKNOWN" },
        { input: { databaseUrl: " ", notionUrl: ` ${IDS[1]} ` }, env: {}, selected: IDS[1], team: "UNKNOWN" },
        ...["team_1", "1팀"].map(sourceTeam => ({ input: { sourceTeam }, env: { NOTION_TEAM1_RESOURCE_DATABASE_ID: IDS[0], NOTION_TEAM1_RESOURCE_URL: IDS[1] }, selected: IDS[0], team: "TEAM_1" })),
        ...["team_2", "2팀"].map(sourceTeam => ({ input: { sourceTeam }, env: { NOTION_TEAM2_RESOURCE_DATABASE_ID: "", NOTION_TEAM2_RESOURCE_URL: IDS[1] }, selected: IDS[1], team: "TEAM_2" })),
        { input: { sourceTeam: "other" }, env: { NOTION_IMPORT_DATABASE_ID: IDS[2], NOTION_IMPORT_DATABASE_URL: IDS[1] }, selected: IDS[2], team: "UNKNOWN" },
        { input: {}, env: { NOTION_IMPORT_DATABASE_ID: "", NOTION_IMPORT_DATABASE_URL: IDS[2] }, selected: IDS[2], team: "UNKNOWN" }
      ];
      for (const item of matrix) {
        config(item.env); const p = probe(); p.databaseId = item.selected;
        const input = { ...item.input, sourceName: `${PRIVATE}-${++seq}` };
        const response = await invoke(a, p, input), id = await success(response);
        assert.deepEqual(p.sourceCalls, [{ suffix: "a", databaseUrlOrId: item.selected, token: TOKEN }]);
        const run = await a.store.one("DataImportRun", { _id: id }); assert.equal(run?.sourceTeam, item.team); assert.equal(run?.workbookName, item.selected);
        await audit(a, response, p);
      }
      config({ NOTION_TEAM1_RESOURCE_DATABASE_ID: " ", NOTION_TEAM1_RESOURCE_URL: IDS[0] });
      const whitespace = await rejected(a, probe(), ERR.id, { sourceTeam: "team_1" });
      assert.equal(whitespace.sourceCalls[0].databaseUrlOrId, " "); assert.equal(whitespace.httpCalls.length, 0);
      config({ NOTION_IMPORT_DATABASE_ID: IDS[0] });
      for (const sourceTeam of ["team_1", "team_2"]) noBusiness(await rejected(a, probe(), ERR.url, { sourceTeam }));
      noBusiness(await rejected(a, probe(), ERR.generic, { databaseUrl: 123, notionUrl: IDS[0] }));
    });

    await scenario("requestActivity earliest; each business port missing precedes ID reader and later sourceName", async a => {
      const scope: Partial<DataRepositories> = { ...a.scope }; delete scope.requestActivity;
      const p = probe("a", null), before = await raw(a.store), auditCount = await a.store.collection("ActivityRequest").countDocuments();
      await assert.rejects(invoke(a, p, {}, scope), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      assert.deepEqual(p.events, []); assert.equal(await raw(a.store), before);
      assert.equal(await a.store.collection("ActivityRequest").countDocuments(), auditCount);
      for (const key of ["notionImportSource", "imports", "teamMembers", "instructorNote"] as const) {
        const partial: Partial<DataRepositories> = { ...a.scope }; delete partial[key];
        for (const changes of [{}, { databaseUrl: "invalid-id" }, { sourceName: 123 }]) {
          noBusiness(await rejected(a, probe(), ERR.generic, { ...nextBody(), ...changes }, partial));
        }
        noBusiness(await rejected(a, probe(), ERR.generic, {}, partial, "{"));
        noBusiness(await rejected(a, probe(), ERR.url, {}, partial));
      }
      const invalid = await rejected(a, probe(), ERR.id, { databaseUrl: "invalid-id" });
      assert.equal(invalid.sourceCalls.length, 1); assert.equal(invalid.httpCalls.length, 0);
    });

    await scenario("sourceName123 follows actual reader/parser/empty check; synthetic count override is route-only", async a => {
      const normal = await rejected(a, probe(), ERR.generic, { ...nextBody(), sourceName: 123 });
      assert.ok(normal.events.includes("source:done")); assert.ok(!normal.events.includes("store:start"));
      const empty = probe(); empty.frames = [{ payload: { results: [] } }];
      await rejected(a, empty, ERR.empty, { ...nextBody(), sourceName: 123 }); assert.ok(empty.events.includes("source:done"));
      const denied = probe(); denied.frames = [{ status: 401 }];
      await rejected(a, denied, ERR.permission, { ...nextBody(), sourceName: 123 }); assert.ok(!denied.events.includes("source:done"));
      const p = probe(); p.countOverride = 17;
      const response = await invoke(a, p, { databaseUrl: IDS[0], sourceName: " " }), id = await success(response, 17);
      const run = await a.store.one("DataImportRun", { _id: id }); assert.equal(run?.rowCount, 1);
      assert.equal(run?.sourceName, "Notion 운영 데이터"); assert.equal(run?.sourceType, "notion");
      const saved = await a.store.scan("OperationSourceRecord", { importRunId: id }); assert.equal(saved.length, 1);
      assert.equal(saved[0].sourceSheet, "Notion"); assert.equal(saved[0].sourceWorkbook, IDS[0]); await audit(a, response, p);
    });

    await scenario("two exact errors only; subclasses, casing, suffix/prefix/newline/cause and non-Errors", async a => {
      for (const message of [ERR.id, ERR.permission]) {
        const variants = [message, `${CANARY}${message}`, `${message}${CANARY}`, `${message}\n`, message.replaceAll("Notion", "notion")];
        for (const value of variants) for (const error of [new Error(value, { cause: new Error(CANARY) }), new MongoServerError({ message: value })]) {
          const p = probe(); p.sourceFault = { value: error };
          await rejected(a, p, value === message ? message : ERR.generic);
          assert.equal(p.sourceCalls.length, 1); assert.equal(p.httpCalls.length, 0);
        }
      }
      for (const value of [null, undefined, ERR.id, { message: ERR.id }, new Error(`${TOKEN}${CANARY}`)]) {
        const p = probe(); p.sourceFault = { value }; await rejected(a, p, ERR.generic);
      }
    });

    await scenario("actual HTTP 401/403/500, later-page and eager-mapping failures leave staging unchanged", async a => {
      for (const status of [401, 403, 429, 500]) {
        const p = probe(); p.frames = [{ status, statusText: CANARY }];
        await rejected(a, p, status === 401 || status === 403 ? ERR.permission : ERR.generic); assert.equal(p.httpCalls.length, 1);
      }
      for (const tail of [{ status: 401 }, { status: 500, statusText: CANARY }, { malformedJSON: true }, { reject: { value: new Error(CANARY) } }]) {
        const p = probe(); p.frames = [{ payload: { results: [page()], has_more: true, next_cursor: "synthetic-next" } }, tail];
        await rejected(a, p, "status" in tail && tail.status === 401 ? ERR.permission : ERR.generic);
        assert.equal(p.httpCalls.length, 2); assert.ok(!p.events.includes("store:start"));
      }
      const malformed = { ...page(), properties: { ...page().properties, malformed: null } };
      const crossed = probe(); crossed.frames = [{ payload: { results: [malformed], has_more: true, next_cursor: "synthetic-next" } }, { status: 401 }];
      await rejected(a, crossed, ERR.permission); assert.equal(crossed.httpCalls.length, 2); // HTTP wins over earlier malformed title.
      const mapping = probe(); mapping.frames = [{ payload: { results: [page()], has_more: true, next_cursor: "synthetic-next" } }, { payload: { results: [malformed] } }];
      await rejected(a, mapping, ERR.generic); assert.equal(mapping.httpCalls.length, 2); assert.ok(!mapping.events.includes("source:done"));
    });

    await scenario("native roster/validator/crypto failure lanes preserve staging and recover", async a => {
      for (const kind of ["members", "instructors"] as const) {
        const fail = async () => { throw new Error(CANARY); };
        const injected = kind === "members" ? mock.method(a.scope.teamMembers, "listRoleRosters", fail) : mock.method(a.scope.instructorNote, "listNotes", fail);
        try { const p = await rejected(a, probe(), ERR.generic); assert.ok(p.events.includes("source:done")); assert.ok(p.events.includes("store:start")); }
        finally { injected.mock.restore(); }
      }
      const collection = a.store.collection("OperationSourceRecord");
      await a.store.db.command({ collMod: collection.collectionName, validator: { $and: [operationMongoValidator("OperationSourceRecord"), { sourceRowNumber: { $lt: 0 } }] } });
      try { await rejected(a, probe(), ERR.generic); }
      finally { await a.store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("OperationSourceRecord") }); }
      const notes = a.store.collection("InstructorNote"), original = await notes.findOne({}); assert.ok(original);
      await notes.updateOne({ _id: original._id }, { $set: { instructorName: CANARY } }, { bypassDocumentValidation: true });
      try { await rejected(a, probe(), ERR.generic); }
      finally { await notes.replaceOne({ _id: original._id }, original, { bypassDocumentValidation: true }); }
      const p = probe(), response = await invoke(a, p); await success(response); await audit(a, response, p);
    });

    await scenario("notion sourceType candidate authenticates HMAC before treating an existing source as absent", async a => {
      const input = nextBody(), p = probe(), response = await invoke(a, p, input), id = await success(response);
      await audit(a, response, p);
      const collection = a.store.collection("DataImportRun"), original = await collection.findOne({ _id: id }); assert.ok(original);
      assert.equal(original.sourceType, "notion");
      await collection.updateOne({ _id: id }, { $set: { sourceNamePiiIndex: "0".repeat(64) } });
      try {
        const failed = await rejected(a, probe(), ERR.generic, input);
        assert.ok(failed.events.includes("roster:instructors")); assert.equal(failed.httpCalls.length, 1);
      } finally { await collection.replaceOne({ _id: id }, original); }
      const recovered = probe(), recovery = await invoke(a, recovered, input);
      assert.equal(recovery.status, 200); const result = await recovery.json();
      assert.deepEqual(result, { ok: true, importRunId: result.importRunId, rowCount: 1, storedCount: 0, duplicateCount: 1, errorCount: 1 });
      assert.notEqual(result.importRunId, id); assert.equal(await a.store.collection("OperationSourceRecord").countDocuments({ importRunId: result.importRunId }), 0);
      await audit(a, recovery, recovered);
    });

    await scenario("immutable shared token with concurrent distinct source/database/namespace A and B", async (a, b) => {
      assert.ok(b); assert.equal(process.env.NOTION_TOKEN, TOKEN);
      const enteredA = barrier(), enteredB = barrier(), release = barrier();
      const pa = Object.assign(probe(), { sourceEntered: enteredA.release, sourceWait: release.promise });
      const pb = Object.assign(probe("b"), { sourceEntered: enteredB.release, sourceWait: release.promise });
      const pending = Promise.all([invoke(a, pa, body("concurrent-a", IDS[0])), invoke(b, pb, body("concurrent-b", IDS[1]))]);
      const failures: unknown[] = [];
      try { await bounded(Promise.race([Promise.all([enteredA.promise, enteredB.promise]), pending.then(() => { throw new Error("EARLY_POST_SETTLE"); })])); }
      catch (error) { failures.push(error); } finally { release.release(); }
      const [ra, rb] = await pending; if (failures.length) throw failures[0];
      const idA = await success(ra), idB = await success(rb); assert.notEqual(idA, idB);
      for (const [native, other, p, response, id, suffix, databaseId] of [[a, b, pa, ra, idA, "a", IDS[0]], [b, a, pb, rb, idB, "b", IDS[1]]] as const) {
        assert.deepEqual(p.sourceCalls, [{ suffix, databaseUrlOrId: databaseId, token: TOKEN }]);
        const run = await native.store.one("DataImportRun", { _id: id }); assert.equal(run?.workbookName, databaseId); assert.equal(run?.importedBy, actor(suffix).user.email);
        const saved = await native.store.scan("OperationSourceRecord", { importRunId: id }); assert.equal(saved.length, 1); assert.deepEqual(saved[0].validationErrors, []);
        assert.equal(saved[0].sourceWorkbook, databaseId); assert.equal((saved[0].mappedFields as Record<string, string>).om, `${PRIVATE}-om-${suffix}`);
        assert.equal(await other.store.one("DataImportRun", { _id: id }), null);
        assert.equal(await other.store.collection("OperationSourceRecord").countDocuments({ importRunId: id }), 0);
        assert.equal(await other.store.one("ActivityRequest", { _id: response.headers.get("X-Request-Id")! }), null);
        await audit(native, response, p);
      }
      const enteredFailure = barrier(), enteredSuccess = barrier(), releaseAgain = barrier();
      const failed = Object.assign(probe(), { sourceFault: { value: new Error(CANARY) }, sourceEntered: enteredFailure.release, sourceWait: releaseAgain.promise });
      const successful = Object.assign(probe("b"), { sourceEntered: enteredSuccess.release, sourceWait: releaseAgain.promise });
      const beforeA = await raw(a.store);
      const mixed = Promise.all([invoke(a, failed, body("concurrent-failure", IDS[0])), invoke(b, successful, body("concurrent-recovery", IDS[1]))]);
      const mixedFailures: unknown[] = [];
      try { await bounded(Promise.race([Promise.all([enteredFailure.promise, enteredSuccess.promise]), mixed.then(() => { throw new Error("EARLY_POST_SETTLE"); })])); }
      catch (error) { mixedFailures.push(error); } finally { releaseAgain.release(); }
      const [failure, recovery] = await mixed; if (mixedFailures.length) throw mixedFailures[0];
      await errorResponse(failure, ERR.generic); const recoveredId = await success(recovery);
      assert.equal(await raw(a.store), beforeA); assert.equal(await a.store.one("DataImportRun", { _id: recoveredId }), null);
      assert.deepEqual(failed.sourceCalls, [{ suffix: "a", databaseUrlOrId: IDS[0], token: TOKEN }]);
      assert.deepEqual(successful.sourceCalls, [{ suffix: "b", databaseUrlOrId: IDS[1], token: TOKEN }]);
      await audit(a, failure, failed); await audit(b, recovery, successful);
      assert.equal(process.env.NOTION_TOKEN, TOKEN); assert.equal(getDataRepositoryOverride("imports"), undefined);
    }, true);

    await scenario("audit finally blocks success/error/redirect settlement; failure retains committed rows and recovery", async a => {
      for (const mode of ["success", "error", "redirect", "audit-failure"] as const) {
        const entered = barrier(), release = barrier(), p = probe("a", mode === "redirect" ? null : actor());
        p.auditEntered = entered.release; p.auditWait = release.promise;
        if (mode === "error") p.sourceFault = { value: new Error(CANARY) };
        if (mode === "audit-failure") p.auditFault = { value: new Error(CANARY, { cause: new Error(TOKEN) }) };
        const ids = new Set((await a.store.scan("ActivityRequest")).map(row => row.id)), logStart = logs.length;
        let settled = false;
        const pending = invoke(a, p).then(response => ({ response }), error => ({ error })).finally(() => { settled = true; });
        const failures: unknown[] = [];
        try {
          await bounded(Promise.race([entered.promise, pending.then(() => { throw new Error("EARLY_POST_SETTLE"); })]));
          await Promise.resolve(); assert.equal(settled, false); assert.equal(p.events.at(-1), "audit:start");
          assert.deepEqual(new Set((await a.store.scan("ActivityRequest")).map(row => row.id)), ids);
        } catch (error) { failures.push(error); } finally { release.release(); }
        const result = await pending; if (failures.length) throw failures[0]; assert.equal(settled, true);
        assert.equal(p.events.filter(event => event === "audit:start").length, 1);
        if ("response" in result) {
          if (mode === "error") await errorResponse(result.response, ERR.generic);
          else {
            const id = await success(result.response); assert.ok(await a.store.one("DataImportRun", { _id: id }));
            assert.equal(await a.store.collection("OperationSourceRecord").countDocuments({ importRunId: id }), 1);
          }
          if (mode === "audit-failure") {
            assert.equal(await a.store.one("ActivityRequest", { _id: result.response.headers.get("X-Request-Id")! }), null);
            assert.deepEqual(logs.slice(logStart), [["[activity] API request log write failed"]]);
          } else await audit(a, result.response, p);
        } else {
          assert.ok(result.error instanceof Error && "digest" in result.error); assert.equal(result.error.digest, "NEXT_REDIRECT;replace;/sign-in;307;");
          const added = (await a.store.scan("ActivityRequest")).filter(row => !ids.has(row.id)); assert.equal(added.length, 1);
          await checkAudit(a, String(added[0].id), 307, p);
        }
      }
      const p = probe(), response = await invoke(a, p); await success(response); await audit(a, response, p);
    });

    await scenario("failure unwinds scope; subsequent explicit/default route selection recovers", async a => {
      const failed = probe(); failed.sourceFault = { value: new Error(CANARY) }; await rejected(a, failed, ERR.generic);
      assert.equal(getDataRepositoryOverride("notionImportSource"), undefined);
      for (const source of ["local", "notion"]) {
        process.env.OPERATION_DATA_SOURCE = source;
        const p = probe(), input = { ...nextBody(), backend: "postgres", token: "synthetic-body-token-not-notion" };
        const req = new Request(`https://example.invalid${ROUTE}?backend=postgres`, { method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json", cookie: "backend=postgres", "x-data-backend": "postgres" } });
        const response = await checkedPost(() => probes.run(p, () => runWithDataRepositories(a.scope, () => POST(req)))); await success(response); await audit(a, response, p);
      }
      // Actual default reader runs, then empty source stops before PG storage.
      // Default-PG successful storage is the independent parity worker's evidence.
      const p = probe(); p.frames = [{ payload: { results: [] } }]; const db = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
      try {
        const response = await checkedPost(() => probes.run(p, () => POST(request(body())))); await errorResponse(response, ERR.empty);
        assert.equal(p.httpCalls.length, 1); assert.equal(p.sourceCalls.length, 0); assert.deepEqual(p.events, ["auth", "auth", "http:1"]);
      } finally { if (db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = db; }
      assert.throws(() => getPrismaClient(), /NOTION_PG_TRIPWIRE/); assert.equal(pgCalls, 1); pgCalls = 0;
    });

    await scenario("transport oracle rejects swallowed bad options and an extra request after script exhaustion", async a => {
      for (const stage of ["options", "script"] as const) {
        assertTransport();
        const p = probe(), before = await raw(a.store), firstAttempt = httpAttempts.length;
        const validOptions: RequestInit = { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
          body: JSON.stringify({ page_size: 100 }), cache: "no-store" };
        const scope = { ...a.scope, notionImportSource: { async readDatabase() {
          const url = `https://api.notion.com/v1/databases/${IDS[0]}/query`;
          if (stage === "script") await fetch(url, validOptions);
          await fetch(url, stage === "options" ? { ...validOptions, method: "GET" } : validOptions);
          throw new Error("TRANSPORT_NEGATIVE_CONTROL_DID_NOT_REJECT");
        } } };
        let caughtResponse: Response | undefined;
        // The real route converts the mock assertion failure to generic400;
        // the independent POST-end oracle must still reject the test result.
        await assert.rejects(checkedPost(async () => {
          caughtResponse = await probes.run(p, () => runWithDataRepositories(scope, () => POST(request(nextBody()))));
          return caughtResponse;
        }), { name: "AssertionError" });
        assert.ok(caughtResponse); await errorResponse(caughtResponse, ERR.generic);
        const attempts = stage === "options" ? 1 : 2;
        assert.equal(p.httpCalls.length, attempts); assert.equal(httpAttempts.length, firstAttempt + attempts);
        assert.deepEqual(transportViolations, [{ attempt: firstAttempt + attempts, stage }]);
        assert.equal(await raw(a.store), before);
        await checkAudit(a, caughtResponse.headers.get("X-Request-Id"), 400, p);
        // Consume ONLY the exact expected negative-control violation after all
        // assertions. Unexpected violations remain fatal at scenario cleanup.
        transportViolations.splice(0, 1);
        assertTransport();
      }
    });

    await suite.test("full leak oracle rejects the 101st entry and long string/Error tail", () => {
      const clean = Array.from({ length: 101 }, () => ({ text: "safe" })); assert.doesNotThrow(() => assertNoLeaks(clean, [CANARY]));
      const late = structuredClone(clean); late[100].text = CANARY;
      for (const value of [late, [late], { tail: `${"x".repeat(20_000)}${CANARY}` }, [[new Error(`${"x".repeat(20_000)}${CANARY}`)]]]) {
        assert.throws(() => assertNoLeaks(value, [CANARY]), { name: "AssertionError", message: "Forbidden canary detected" });
      }
      assert.doesNotThrow(() => assertNoLeaks({ text: "x".repeat(20_000) }, [CANARY]));
    });
  } finally {
    try { await client.close(); }
    finally {
      hooks.deregister(); fetchMock.mock.restore(); for (const capture of captures) capture.mock.restore(); for (const moduleMock of modules) moduleMock.restore();
      for (const name of envKeys) delete process.env[name]; if (savedTZ === undefined) delete process.env.TZ; else process.env.TZ = savedTZ;
    }
  }
});
