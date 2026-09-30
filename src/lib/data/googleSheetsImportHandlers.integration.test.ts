/** V3/V4/V6 actual POST/guard/withActivity/native repositories. Parent executes.
 * Opt-in: MONGODB_SHEETS_IMPORT_TEST_URI must equal the fixture URI exactly.
 * Node 24 --experimental-strip-types --experimental-test-module-mocks
 * --experimental-loader ./scripts/ts-loader.mjs --test THIS_FILE
 * Start with env -i; no dotenv. V1/V2/V5 actual default-PG parity and V7
 * transaction schedules belong to sibling suites, not this native proof.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { inspect } from "node:util";
import { mock, test } from "node:test";
import { MongoClient, MongoServerError } from "mongodb";
import { getDataRepositoryOverride, runWithDataRepositories, type DataRepositories } from "./dataRepositoryContext";
import { operationMongoValidator } from "./mongoOperationStore";
import { URI, ROOT, PRIVATE, CANARY, TABS, HEADERS, ERRORS, actor, probe, probes, current, barrier, bounded, rows, body, request,
  setup, snapshot, success, errorResponse, checkAudit, type Native, type Endpoint, type Probe } from "./sheetsImportHandlerNative.fixture";

const uri = process.env.MONGODB_SHEETS_IMPORT_TEST_URI;
function assertNoLeaks(value: unknown, forbidden: readonly string[]) {
  const text = inspect(value, { depth: null, maxArrayLength: null, maxStringLength: null });
  for (const secret of forbidden) assert.ok(!text.includes(secret), "Forbidden canary detected");
}
test("Sheets V3/V4/V6 actual native handler boundaries", { skip: !uri, timeout: 240_000 }, async suite => {
  assert.equal(uri, URI, "Only the parent-owned Sheets replica endpoint is permitted");
  const envNames = ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY",
    "PII_ALLOW_PLAINTEXT_READS", "DEV_AUTH_BYPASS", "DEV_AUTH_EMAIL", "ADMIN_EMAILS", "OPERATION_DATA_SOURCE", "TZ"];
  for (const name of envNames) assert.equal(process.env[name], undefined, `Run sanitized env -i; inherited ${name}`);
  assert.equal((globalThis as { prisma?: unknown }).prisma, undefined, "isolated worker required");
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ sheets: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "sheets", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: "", OPERATION_DATA_SOURCE: "local", TZ: "UTC",
    DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/sheets_pg_tripwire" });
  let pgCalls = 0, localCalls = 0, notionCalls = 0, externalCalls = 0;
  const logs: unknown[][] = [];
  const captures = (["error", "warn", "log", "info", "debug"] as const).map(level =>
    mock.method(console, level, (...args: unknown[]) => { logs.push(args); }));
  const external = mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const p = probes.getStore();
    if (p?.transport) {
      assert.equal(input, "https://sheets.googleapis.com/v4/spreadsheets/synthetic-book?fields=sheets(properties(sheetId,title,index))");
      assert.deepEqual(init, { headers: { authorization: `Bearer ${p.session?.googleAccessToken}` } });
      p.transport.calls.push([input, init]);
      return new Response(p.transport.jsonFault ? "{" : JSON.stringify({ sheets: TABS.map(tab => ({ properties: { sheetId: tab.gid, title: tab.title } })) }),
        { status: p.transport.status, headers: { "content-type": "application/json" } });
    }
    externalCalls++; throw new Error("SHEETS_EXTERNAL_FETCH_FORBIDDEN");
  });
  const modules = [
    mock.module("@/auth", { namedExports: { auth: async () => { const p = current(); p.events.push("auth"); return p.session; } } }),
    // Below actual getPrismaClient guard: no replacement of parser/writer/auth guard.
    mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class {
      constructor() { pgCalls++; throw new Error("SHEETS_PG_TRIPWIRE"); }
    } } }),
    mock.module("./localJsonTeamMemberRepository", { namedExports: { LocalJsonTeamMemberRepository: class {
      constructor() { localCalls++; throw new Error("SHEETS_LOCAL_TRIPWIRE"); }
    } } }),
    mock.module("./localJsonInstructorNoteRepository", { namedExports: { LocalJsonInstructorNoteRepository: class {
      constructor() { localCalls++; throw new Error("SHEETS_LOCAL_TRIPWIRE"); }
    } } }),
    mock.module("./notionTeamMemberRepository", { namedExports: { getNotionTeamMemberRepository: () => {
      notionCalls++; throw new Error("SHEETS_NOTION_TRIPWIRE");
    } } })
  ];
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(["next/server", "next/navigation", "next/cache"].includes(specifier) ? `${specifier}.js` : specifier, context);
  } });
  const client = new MongoClient(URI, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const owned: string[] = [];
  const natives: Native[] = [];
  try {
    const { POST: tabsPOST } = await import("../../app/api/admin/imports/google-sheets/tabs/route");
    const { POST: importPOST } = await import("../../app/api/admin/imports/google-sheets/import/route");
    const { getPrismaClient } = await import("./prisma");
    const { getGoogleSheetsImportSource } = await import("./googleSheetsImportSource");
    const defaultSource = getGoogleSheetsImportSource();
    const endpoints = { tabs: tabsPOST, import: importPOST };
    assert.throws(() => getPrismaClient(), /SHEETS_PG_TRIPWIRE/); assert.equal(pgCalls, 1); pgCalls = 0;
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.setName, "sheetsimport20260930");
    assert.deepEqual(hello.hosts, ["127.0.0.1:27851"]);
    const options = await client.db("admin").command({ getCmdLineOpts: 1 });
    const dbPath = options.parsed?.storage?.dbPath;
    assert.ok(typeof dbPath === "string" && dbPath.startsWith(`${ROOT}/`) && !dbPath.includes(".."), "unexpected server dbPath");
    for (const suffix of ["a", "b"]) {
      const name = `hub_om_shadow_sheets_handlers_${randomBytes(8).toString("hex")}_${suffix}`;
      assert.equal((await client.db(name).listCollections({}, { nameOnly: true }).toArray()).length, 0);
      owned.push(name); natives.push(await setup(client, name, suffix));
    }
    const [a, b] = natives;
    let sequence = 0;
    const uniqueBody = () => body(`request-${++sequence}`);
    function invoke(endpoint: Endpoint, p: Probe, input: unknown = uniqueBody(), scope: Partial<DataRepositories> = a.scope,
      authorization = false, raw?: string) {
      return probes.run(p, () => runWithDataRepositories(scope, () => endpoints[endpoint](request(endpoint, input, authorization, raw))));
    }
    function noFallback() { assert.deepEqual({ pgCalls, localCalls, notionCalls, externalCalls }, { pgCalls: 0, localCalls: 0, notionCalls: 0, externalCalls: 0 }); }
    function noBusiness(p: Probe) {
      assert.equal(p.sourceCalls.length, 0);
      assert.ok(!p.events.some(event => event.startsWith("store:") || event.startsWith("roster:")));
    }
    async function audit(response: Response, p: Probe, endpoint: Endpoint, authorization = false, native = a) {
      await checkAudit(native.store, response.headers.get("X-Request-Id"), endpoint, response.status, p.session, authorization);
      assert.equal(p.events.filter(event => event === "audit:start").length, 1);
      assert.equal(p.events.at(-1), "audit:done"); noFallback();
    }
    async function auditIds(native = a) { return new Set((await native.store.scan("ActivityRequest")).map(row => String(row.id))); }
    async function checkRedirect(endpoint: Endpoint, p: Probe, authorization: boolean) {
      const before = await snapshot(a.store), ids = await auditIds();
      await assert.rejects(invoke(endpoint, p, uniqueBody(), a.scope, authorization), (error: unknown) => {
        assert.ok(error instanceof Error && "digest" in error);
        assert.equal(error.digest, "NEXT_REDIRECT;replace;/sign-in;307;"); return true;
      });
      const added = (await a.store.scan("ActivityRequest")).filter(row => !ids.has(String(row.id)));
      assert.equal(added.length, 1);
      await checkAudit(a.store, String(added[0].id), endpoint, 307, p.session, authorization);
      assert.equal(p.events.filter(event => event === "auth").length, authorization ? 1 : 2);
      assert.equal(p.events.filter(event => event === "audit:start").length, 1);
      assert.equal(p.events.at(-1), "audit:done"); noBusiness(p);
      assert.equal(await snapshot(a.store), before); noFallback();
    }

    await suite.test("both POSTs: six auth fixture categories retain real guard and audit attribution", async () => {
      for (const endpoint of ["tabs", "import"] as const) {
        for (const authorization of [false, true]) {
          const p = probe(), response = await invoke(endpoint, p, uniqueBody(), a.scope, authorization);
          const id = await success(response, endpoint);
          assert.equal(p.events.filter(event => event === "auth").length, authorization ? 1 : 2);
          assert.deepEqual(p.sourceCalls, [["a", endpoint === "tabs" ? "tabs" : "rows", actor().googleAccessToken,
            "synthetic-book", ...(endpoint === "import" ? ["합성 탭"] : [])]]);
          if (id) {
            const run = await a.store.one("DataImportRun", { _id: id }); assert.ok(run);
            assert.equal(run.importedBy, actor().user.email); // NOT lowercased like audit actor.
            assert.equal(run.sourceType, "spreadsheet"); assert.equal(run.sourceTeam, "TEAM_1");
            const saved = await a.store.scan("OperationSourceRecord", { importRunId: id });
            assert.equal(saved.length, 1); assert.equal(saved[0].operationSessionId, null);
            assert.deepEqual(saved[0].validationErrors, []);
            assert.deepEqual(p.events, [...Array(authorization ? 1 : 2).fill("auth"), "source:rows", "source:done", "store:start",
              "roster:members", "roster:instructors", "store:done", "audit:start", "audit:done"]);
          }
          await audit(response, p, endpoint, authorization);
          for (const denied of [null, { ...actor(), user: { email: "outsider@example.invalid", name: "Synthetic outsider" } }]) {
            await checkRedirect(endpoint, probe(denied), authorization);
          }
          const missingToken = probe({ ...actor(), googleAccessToken: undefined }), before = await snapshot(a.store);
          const response401 = await invoke(endpoint, missingToken, uniqueBody(), a.scope, authorization);
          assert.equal(response401.status, 401);
          assert.deepEqual(await response401.json(), { ok: false, error: "Google 스프레드시트 읽기 권한이 필요합니다.", reauthRequired: true });
          assert.equal(missingToken.events.filter(event => event === "auth").length, authorization ? 1 : 2);
          noBusiness(missingToken); await audit(response401, missingToken, endpoint, authorization);
          assert.equal(await snapshot(a.store), before);
        }
      }
    });

    await suite.test("requestActivity missing precedes auth; tabs require no import or roster ports", async () => {
      for (const endpoint of ["tabs", "import"] as const) {
        const p = probe(null), before = await snapshot(a.store), ids = await auditIds();
        const scope: Partial<DataRepositories> = { ...a.scope }; delete scope.requestActivity;
        await assert.rejects(invoke(endpoint, p, uniqueBody(), scope), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
        assert.deepEqual(p.events, []); assert.equal(await snapshot(a.store), before); assert.deepEqual(await auditIds(), ids);
      }
      const p = probe(), response = await invoke("tabs", p, body(), {
        googleSheetsImportSource: a.scope.googleSheetsImportSource, requestActivity: a.scope.requestActivity
      });
      await success(response, "tabs"); await audit(response, p, "tabs");
      assert.ok(!p.events.some(event => event.startsWith("roster:") || event.startsWith("store:")));
    });

    await suite.test("each missing business port preflights before source, including later malformed inputs", async () => {
      for (const key of ["googleSheetsImportSource", "imports", "teamMembers", "instructorNote"] as const) {
        const scope: Partial<DataRepositories> = { ...a.scope }; delete scope[key];
        for (const changes of [{}, { sourceName: 123 }, { headerRowNumber: 999 }]) {
          const p = probe(), before = await snapshot(a.store);
          const response = await invoke("import", p, { ...uniqueBody(), ...changes }, scope);
          await errorResponse(response, ERRORS.import); noBusiness(p); await audit(response, p, "import");
          assert.equal(await snapshot(a.store), before);
        }
      }
      const scope: Partial<DataRepositories> = { requestActivity: a.scope.requestActivity };
      const p = probe(), response = await invoke("tabs", p, body(), scope);
      await errorResponse(response, ERRORS.tabs); noBusiness(p); await audit(response, p, "tabs");
    });

    await suite.test("JSON/tab/URL/token errors precede missing source and store scopes", async () => {
      const scope = { requestActivity: a.scope.requestActivity };
      for (const endpoint of ["tabs", "import"] as const) {
        for (const item of [
          { input: body(), raw: "{", expected: ERRORS[endpoint] },
          { input: { ...body(), spreadsheetUrl: "bad" }, expected: ERRORS.url },
          ...(endpoint === "import" ? [{ input: { ...body(), tabTitle: " " }, expected: "가져올 탭을 선택해 주세요." },
            { input: { ...body(), tabTitle: 123 }, expected: ERRORS.import }] : [])
        ]) {
          const p = probe(), before = await snapshot(a.store);
          const response = await invoke(endpoint, p, item.input, scope, false, "raw" in item ? item.raw : undefined);
          await errorResponse(response, item.expected); noBusiness(p); await audit(response, p, endpoint);
          assert.equal(await snapshot(a.store), before);
        }
        const p = probe({ ...actor(), googleAccessToken: undefined });
        const response = await invoke(endpoint, p, body(), scope, false, "{");
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { ok: false, error: "Google 스프레드시트 읽기 권한이 필요합니다.", reauthRequired: true });
        noBusiness(p); await audit(response, p, endpoint);
      }
    });

    await suite.test("sourceName123 evaluates after fetch/parser/empty-row check; source failure wins", async () => {
      const cases = [
        { rows: rows(), expected: ERRORS.import },
        { rows: [HEADERS], expected: "저장할 행이 없습니다." },
        { rows: [], expected: ERRORS.header },
        { rows: [42] as unknown as string[][], expected: ERRORS.import },
        { rows: rows(), fault: { value: new Error(ERRORS.permission) }, expected: ERRORS.permission }
      ];
      for (const item of cases) {
        const p = Object.assign(probe(), item), before = await snapshot(a.store);
        const response = await invoke("import", p, { ...uniqueBody(), sourceName: 123 });
        await errorResponse(response, item.expected); assert.equal(p.sourceCalls.length, 1);
        assert.ok(!p.events.includes("store:start")); assert.ok(!p.events.includes("roster:members"));
        await audit(response, p, "import"); assert.equal(await snapshot(a.store), before);
      }
    });

    await suite.test("route-specific exact allowlist only, including Error subclasses and non-Errors", async () => {
      for (const endpoint of ["tabs", "import"] as const) {
        const allowed = [ERRORS.url, ERRORS.permission, ERRORS.read, ...(endpoint === "import" ? [ERRORS.header] : [])];
        for (const text of allowed) {
          const disallowed = [`${CANARY}${text}`, `${text}${CANARY}`, `${text}\n`, text.replace(/\.$/, "!"),
            ...(text.includes("Google") ? [text.replaceAll("Google", "google")] : [])];
          const variants: Array<{ value: unknown; expected: string }> = [
            { value: new Error(text), expected: text }, { value: new MongoServerError({ message: text }), expected: text },
            ...disallowed.flatMap(value => [new Error(value), new MongoServerError({ message: value })]
              .map(error => ({ value: error, expected: ERRORS[endpoint] }))),
            { value: { message: text }, expected: ERRORS[endpoint] }, { value: text, expected: ERRORS[endpoint] }
          ];
          for (const item of variants) {
            const p = probe(); p.fault = { value: item.value };
            const before = await snapshot(a.store), response = await invoke(endpoint, p);
            await errorResponse(response, item.expected); assert.equal(p.sourceCalls.length, 1);
            assert.ok(!p.events.includes("store:start")); await audit(response, p, endpoint);
            assert.equal(await snapshot(a.store), before);
          }
        }
        for (const value of [null, undefined, new Error(`${CANARY} raw row token`, { cause: new Error(CANARY) }),
          ...(endpoint === "tabs" ? [new Error(ERRORS.header), new MongoServerError({ message: ERRORS.header })] : [])]) {
          const p = probe(); p.fault = { value };
          const response = await invoke(endpoint, p); await errorResponse(response, ERRORS[endpoint]); await audit(response, p, endpoint);
        }
      }
      assertNoLeaks(logs, [CANARY]);
    });

    await suite.test("labelled roster failure injection and native validator failure preserve staging", async () => {
      for (const which of ["members", "instructors"] as const) {
        const fail = async () => { throw new Error(CANARY, { cause: new Error(CANARY) }); };
        const injected = which === "members" ? mock.method(a.scope.teamMembers, "listRoleRosters", fail)
          : mock.method(a.scope.instructorNote, "listNotes", fail);
        try {
          const p = probe(), before = await snapshot(a.store), response = await invoke("import", p);
          await errorResponse(response, ERRORS.import); assert.equal(p.sourceCalls.length, 1);
          assert.ok(p.events.includes("store:start")); await audit(response, p, "import"); assert.equal(await snapshot(a.store), before);
        } finally { injected.mock.restore(); }
      }
      const collection = a.store.collection("OperationSourceRecord");
      await a.store.db.command({ collMod: collection.collectionName,
        validator: { $and: [operationMongoValidator("OperationSourceRecord"), { sourceRowNumber: { $lt: 0 } }] } });
      try {
        const p = probe(), before = await snapshot(a.store), response = await invoke("import", p);
        await errorResponse(response, ERRORS.import); assert.ok(p.events.includes("roster:instructors"));
        await audit(response, p, "import"); assert.equal(await snapshot(a.store), before);
      } finally {
        await a.store.db.command({ collMod: collection.collectionName, validator: operationMongoValidator("OperationSourceRecord") });
      }
      const p = probe(), response = await invoke("import", p); await success(response, "import"); await audit(response, p, "import");
    });

    await suite.test("real default HTTP adapter with synthetic 403/500/malformed JSON preserves safe errors and native audit", async () => {
      for (const item of [{ status: 403, expected: ERRORS.permission }, { status: 500, expected: ERRORS.read },
        { status: 200, jsonFault: true, expected: ERRORS.tabs }]) {
        const p = probe(); p.transport = { ...item, calls: [] };
        const before = await snapshot(a.store);
        const response = await invoke("tabs", p, body(), { ...a.scope, googleSheetsImportSource: defaultSource });
        await errorResponse(response, item.expected); assert.equal(p.transport.calls.length, 1);
        await audit(response, p, "tabs"); assert.equal(await snapshot(a.store), before);
      }
    });

    await suite.test("native corrupt encrypted instructor data fails safely after source, with no staging writes", async () => {
      const collection = a.store.collection("InstructorNote"), original = await collection.findOne({}); assert.ok(original);
      await collection.updateOne({ _id: original._id }, { $set: { instructorName: CANARY } }, { bypassDocumentValidation: true });
      try {
        const p = probe(), before = await snapshot(a.store), response = await invoke("import", p);
        await errorResponse(response, ERRORS.import); assert.equal(p.sourceCalls.length, 1);
        assert.ok(p.events.includes("roster:instructors")); assert.ok(!p.events.includes("store:done"));
        await audit(response, p, "import"); assert.equal(await snapshot(a.store), before);
      } finally { await collection.replaceOne({ _id: original._id }, original, { bypassDocumentValidation: true }); }
    });

    await suite.test("concurrent A/B native namespaces retain source/token/roster/actor and request IDs", async () => {
      const enteredA = barrier(), enteredB = barrier(), releaseA = barrier(), releaseB = barrier();
      const pa = Object.assign(probe(actor("a")), { sourceEntered: enteredA.release, sourceWait: releaseA.promise });
      const pb = Object.assign(probe(actor("b")), { sourceEntered: enteredB.release, sourceWait: releaseB.promise });
      const inputA = body("concurrent-a"), inputB = body("concurrent-b");
      const pendingA = invoke("import", pa, inputA, a.scope), pendingB = invoke("import", pb, inputB, b.scope);
      const pending = Promise.all([pendingA, pendingB]);
      const failures: unknown[] = [];
      try { await bounded(Promise.race([Promise.all([enteredA.promise, enteredB.promise]), pending.then(() => {
        throw new Error("REQUESTS_FINISHED_BEFORE_SOURCE_BARRIERS");
      })]), "concurrent sources"); }
      catch (error) { failures.push(error); }
      finally { releaseB.release(); releaseA.release(); }
      const [ra, rb] = await pending;
      if (failures.length) throw failures[0];
      const idA = await success(ra, "import"), idB = await success(rb, "import"); assert.ok(idA && idB);
      assert.notEqual(idA, idB); assert.notEqual(ra.headers.get("X-Request-Id"), rb.headers.get("X-Request-Id"));
      for (const [native, other, p, id, suffix, response, input] of [
        [a, b, pa, idA, "a", ra, inputA], [b, a, pb, idB, "b", rb, inputB]
      ] as const) {
        assert.deepEqual(p.sourceCalls, [[suffix, "rows", actor(suffix).googleAccessToken, "synthetic-book", "합성 탭"]]);
        const run = await native.store.one("DataImportRun", { _id: id }); assert.ok(run);
        assert.equal(run.importedBy, actor(suffix).user.email); assert.equal(run.sourceName, input.sourceName);
        const saved = await native.store.scan("OperationSourceRecord", { importRunId: id });
        assert.equal(saved.length, 1); assert.equal(saved[0].importRunId, id); assert.equal(saved[0].operationSessionId, null);
        assert.deepEqual(saved[0].validationErrors, []);
        assert.equal((saved[0].mappedFields as Record<string, string>).om, `${PRIVATE}-om-${suffix}`);
        assert.equal((saved[0].mappedFields as Record<string, string>).ld, `${PRIVATE}-ld-${suffix}`);
        assert.equal((saved[0].mappedFields as Record<string, string>).instructors, `${PRIVATE}-instructor-${suffix}`);
        assert.equal(await other.store.one("DataImportRun", { _id: id }), null);
        assert.equal(await other.store.collection("OperationSourceRecord").countDocuments({ importRunId: id }), 0);
        assert.equal(await other.store.one("ActivityRequest", { _id: response.headers.get("X-Request-Id")! }), null);
        await audit(response, p, "import", false, native);
      }
      assert.equal(getDataRepositoryOverride("imports"), undefined);
      assert.equal(getDataRepositoryOverride("googleSheetsImportSource"), undefined);
    });

    await suite.test("audit finally awaits before POST resolves/rejects, including committed success and redirect", async () => {
      for (const mode of ["success", "error", "redirect"] as const) {
        const entered = barrier(), released = barrier();
        const p = Object.assign(probe(mode === "redirect" ? null : actor()), { auditEntered: entered.release, auditWait: released.promise });
        if (mode === "error") p.fault = { value: new Error(CANARY) };
        const ids = await auditIds(); let settled = false;
        const pending = invoke("import", p).then(response => ({ response }), error => ({ error })).finally(() => { settled = true; });
        const failures: unknown[] = [];
        try {
          await bounded(Promise.race([entered.promise, pending.then(() => { throw new Error("POST_SETTLED_BEFORE_AUDIT_BARRIER"); })]), "audit finally");
          await Promise.resolve(); assert.equal(settled, false);
          assert.equal(p.events.at(-1), "audit:start"); assert.deepEqual(await auditIds(), ids);
          if (mode === "success") assert.ok(p.events.includes("store:done"));
        } catch (error) { failures.push(error); }
        finally { released.release(); }
        const result = await pending; assert.equal(settled, true);
        if (failures.length) throw failures[0];
        if ("response" in result) {
          if (mode === "success") await success(result.response, "import"); else await errorResponse(result.response, ERRORS.import);
          await audit(result.response, p, "import");
        } else {
          assert.ok(result.error instanceof Error && "digest" in result.error);
          assert.equal(result.error.digest, "NEXT_REDIRECT;replace;/sign-in;307;");
          const added = (await a.store.scan("ActivityRequest")).filter(row => !ids.has(String(row.id)));
          assert.equal(added.length, 1); await checkAudit(a.store, String(added[0].id), "import", 307, null);
          assert.equal(p.events.at(-1), "audit:done");
        }
      }
    });

    await suite.test("labelled audit rejection keeps success/commit, one fixed log, and recovers", async () => {
      const p = probe(); p.auditFault = { value: new Error(CANARY, { cause: new Error(CANARY) }) };
      const start = logs.length, response = await invoke("import", p), id = await success(response, "import"); assert.ok(id);
      assert.equal(p.events.filter(event => event === "audit:start").length, 1);
      assert.deepEqual(logs.slice(start), [["[activity] API request log write failed"]]);
      assert.ok(await a.store.one("DataImportRun", { _id: id }));
      assert.equal(await a.store.collection("OperationSourceRecord").countDocuments({ importRunId: id }), 1);
      assert.equal(await a.store.one("ActivityRequest", { _id: response.headers.get("X-Request-Id")! }), null);
      noFallback();
      const next = probe(), recovered = await invoke("import", next); await success(recovered, "import"); await audit(recovered, next, "import");
    });

    await suite.test("failed request scope unwinds; HTTP backend hints do not replace explicit native scope", async () => {
      const p = probe(); p.fault = { value: new Error(CANARY) };
      await errorResponse(await invoke("import", p), ERRORS.import);
      assert.equal(getDataRepositoryOverride("imports"), undefined);
      for (const hint of ["local", "notion"]) {
        process.env.OPERATION_DATA_SOURCE = hint;
        const next = probe(), input = { ...uniqueBody(), backend: "postgres", namespace: "other" };
        const req = new Request("https://example.invalid/api/admin/imports/google-sheets/import?backend=postgres&namespace=other", {
          method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json",
            "x-data-backend": "postgres", cookie: "backend=postgres" }
        });
        const response = await probes.run(next, () => runWithDataRepositories(a.scope, () => importPOST(req)));
        await success(response, "import"); await audit(response, next, "import");
      }
      // Default selection is observable without opening PG. Actual default-PG
      // success belongs to the parity worker, not this downstream tripwire.
      const defaultProbe = probe(); defaultProbe.transport = { status: 200, calls: [] };
      const beforeDefault = await snapshot(a.store), ids = await auditIds();
      const tripwireURL = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL; // Original default audit skips when no DB is configured.
      try {
        const response = await probes.run(defaultProbe, () => tabsPOST(request("tabs", body())));
        await success(response, "tabs"); assert.equal(defaultProbe.transport.calls.length, 1);
        assert.equal(defaultProbe.sourceCalls.length, 0); assert.deepEqual(defaultProbe.events, ["auth", "auth"]);
        assert.equal(await snapshot(a.store), beforeDefault); assert.deepEqual(await auditIds(), ids);
      } finally { if (tripwireURL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = tripwireURL; }
      assert.throws(() => getPrismaClient(), /SHEETS_PG_TRIPWIRE/); assert.equal(pgCalls, 1); pgCalls = 0;
      noFallback();
    });

    await suite.test("leak oracle rejects canaries beyond array/string inspect defaults", () => {
      const clean = Array.from({ length: 101 }, () => ({ value: "safe" }));
      assert.doesNotThrow(() => assertNoLeaks(clean, [CANARY]));
      const lateItem = structuredClone(clean); lateItem[100].value = CANARY;
      const longTail = `${"x".repeat(20_000)}${CANARY}`;
      // The same assertion used for raw/decoded/log evidence must reject both
      // failures, including nesting used by collection snapshots and log arrays.
      for (const value of [lateItem, [lateItem], { value: longTail }, [[new Error(longTail)]]]) {
        assert.throws(() => assertNoLeaks(value, [CANARY]), { name: "AssertionError", message: "Forbidden canary detected" });
      }
      assert.doesNotThrow(() => assertNoLeaks({ value: "x".repeat(20_000) }, [CANARY]));
    });

    await suite.test("no error/token leaks in response logs/audit/storage; no staging mutation audit or promotion", async () => {
      for (const native of natives) {
        const collections = await native.store.db.listCollections({}, { nameOnly: true }).toArray();
        const raw = await Promise.all(collections.map(item => native.store.db.collection(item.name).find({}).toArray()));
        assertNoLeaks(raw, [CANARY, actor("a").googleAccessToken!, actor("b").googleAccessToken!, PRIVATE]);
        for (const model of native.store.models) {
          const decoded = await native.store.scan(model);
          assertNoLeaks(decoded, [CANARY, actor("a").googleAccessToken!, actor("b").googleAccessToken!]);
        }
        const runs = await native.store.collection("DataImportRun").find({}).toArray(); assert.ok(runs.length > 0);
        for (const run of runs) {
          assert.match(String(run.sourceName), /^pii:v1:sheets:/);
          assert.match(String(run.importedBy), /^pii:v1:sheets:/);
          assert.ok(typeof run.sourceNamePiiIndex === "string" && run.sourceNamePiiIndex.length > 0);
          assert.ok(typeof run.importedByPiiIndex === "string" && run.importedByPiiIndex.length > 0);
        }
        assert.equal(await native.store.collection("ActivityChange").countDocuments(), 0);
        for (const model of ["Company", "Course", "OperationSession"]) assert.equal(await native.store.collection(model).countDocuments(), 0);
        assert.equal(await native.store.collection("OperationSourceRecord").countDocuments({ operationSessionId: { $ne: null } }), 0);
      }
      assertNoLeaks(logs, [CANARY, PRIVATE, actor("a").googleAccessToken!, actor("b").googleAccessToken!]);
      noFallback();
    });
  } finally {
    try {
      for (const native of natives) native.restore();
      for (const name of owned) {
        await client.db(name).dropDatabase();
        assert.equal((await client.db(name).listCollections({}, { nameOnly: true }).toArray()).length, 0);
      }
    } finally {
      await client.close(); hooks.deregister(); external.mock.restore();
      for (const capture of captures) capture.mock.restore();
      for (const moduleMock of modules) moduleMock.restore();
      for (const name of envNames) delete process.env[name];
    }
  }
});
