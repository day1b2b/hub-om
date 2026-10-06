/** Separate process per backend. Current/native never supply expected DTO/selector/comparator. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { MongoClient } from "mongodb";
import { Prisma, type PrismaClient } from "@prisma/client";
import { frozen, verifyClosure } from "./frozen-loader.fixture.ts";
import { AT, OLD, LATE, DB_NULL, JSON_NULL, runId, resultId, runSeed, resultSeed, expectedRun, expectedRow, expectedSingle, richSeed, richRow, richSingle, assertExact, assertOneComplete, assertGroups, comparatorControls, type Row, type Reader } from "./parity-literals.fixture.ts";

const PG_URL = "postgresql://synthetic@127.0.0.1:56750/drive_history_test";
const MONGO_URI = "mongodb://127.0.0.1:27850/?replicaSet=drivehistory20260930";
const current = <T>(origin: string) => import(new URL(`../../../../${origin}`, import.meta.url).href) as Promise<T>;
async function send(value: unknown) {
  assert.ok(process.send); await new Promise<void>((resolve,reject) => process.send!(value,error => error ? reject(error) : resolve()));
}
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const column = (name: string) => name.replace(/[A-Z]/g, match => `_${match.toLowerCase()}`);
async function main() {
  verifyClosure(); comparatorControls();
  const backend = process.argv[2]; assert.ok(["original", "current", "mongo"].includes(backend));
  assert.equal(process.env.PG_DRIVE_HISTORY_TEST_DATABASE_URL, PG_URL);
  assert.equal(process.env.MONGODB_DRIVE_HISTORY_TEST_URI, MONGO_URI);
  for (const key of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY"]) assert.equal(process.env[key], undefined);
  Object.assign(process.env, { TZ: "UTC", PII_ACTIVE_KEY_ID: "parity", PII_ENCRYPTION_KEYS: JSON.stringify({ parity: randomBytes(32).toString("base64") }), PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  if (backend !== "mongo") process.env.DATABASE_URL = PG_URL;
  globalThis.fetch = async () => { throw new Error("DRIVE_PARITY_EXTERNAL_FETCH_FORBIDDEN"); };
  let sql: pg.Client | undefined, prisma: PrismaClient | undefined, client: MongoClient | undefined;
  let pgOwned = false, mongoOwned = false, databaseName = "";
  const ownedRuns = new Set<string>();
  let seed: (runs: Row[], results: Row[]) => Promise<void>;
  let raw: () => Promise<unknown>;
  let api: Reader;
  const ledger: Array<{ name: string; value: unknown }> = [];
  const mark = async (name: string, value: unknown = "literal-pass") => { ledger.push({ name, value }); await send({ kind: "case", backend, name }); };
  try {
    if (backend !== "mongo") {
      const dir = process.env.PG_DRIVE_HISTORY_TEST_DATA_DIRECTORY;
      assert.ok(dir?.startsWith("/private/tmp/hub-om-drive-import-history-20260930/") && !dir.includes(".."));
      sql = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000, query_timeout: 15000, options: "-c timezone=UTC -c statement_timeout=15000" }); await sql.connect();
      assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port")).rows, [{ db: "drive_history_test", usr: "synthetic", port: 56750 }]);
      assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory, dir);
      assert.equal((await sql.query("SELECT pg_try_advisory_lock(73137056750::bigint) AS owned")).rows[0].owned, true);
      assert.deepEqual((await sql.query("SELECT (SELECT count(*)::int FROM drive_import_runs) AS runs,(SELECT count(*)::int FROM drive_import_results) AS results")).rows, [{ runs: 0, results: 0 }]); pgOwned = true;
      assert.deepEqual((await sql.query("SELECT datcollate,datctype,encoding,datlocprovider FROM pg_database WHERE datname=current_database()")).rows, [{ datcollate: "C", datctype: "C", encoding: 0, datlocprovider: "c" }], "this fixture pins the observed synthetic SQL_ASCII/C baseline; never production");
      const load = backend === "original" ? frozen : current;
      prisma = (await load<{ getPrismaClient(): PrismaClient }>("src/lib/data/prisma.ts")).getPrismaClient();
      api = await load<Reader>("src/lib/driveImports/driveImportResults.ts");
      const fields = await frozen<typeof import("../../../../src/lib/privacy/fields")>("src/lib/privacy/fields.ts");
      async function insert(model: string, input: Row) {
        const table = model === "DriveImportRun" ? "drive_import_runs" : "drive_import_results";
        const keys: string[] = [], values: unknown[] = [];
        for (const [key, value] of Object.entries(input)) {
          const policy = fields.privacyFields[model]?.fields[key];
          let encoded: unknown = value;
          if (value === DB_NULL) encoded = null;
          else if (policy) encoded = fields.encryptField(model, key, value === JSON_NULL ? Prisma.JsonNull : value);
          if (policy?.type === "Json" && encoded !== null) encoded = JSON.stringify(encoded);
          if (key === "status") encoded = String(value).toLowerCase();
          keys.push(column(key)); values.push(encoded);
          if (policy?.indexColumn) { keys.push(policy.indexColumn); values.push(fields.indexField(model, key, value)); }
        }
        await sql!.query(`INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(",")}) VALUES (${values.map((_,i) => `$${i+1}`).join(",")})`, values);
        // Validate backend seed meaning independently of the reader and its formatter.
        const stored = (await sql!.query(`SELECT * FROM ${table} WHERE id=$1`, [input.id])).rows[0]; assert.ok(stored);
        for (const [key, value] of Object.entries(input)) {
          let decoded: unknown = stored[column(key)];
          if (fields.privacyFields[model]?.fields[key]) decoded = fields.decryptField(model, key, decoded);
          if (value instanceof Date) decoded = new Date(decoded as string | Date).toISOString();
          if (key === "status") decoded = String(decoded).toUpperCase();
          assert.deepEqual(decoded, value === DB_NULL || value === JSON_NULL ? null : value instanceof Date ? value.toISOString() : value, `seed ${model}.${key}`);
        }
      }
      seed = async (runs, results) => {
        if (ownedRuns.size) await sql!.query("DELETE FROM drive_import_runs WHERE id=ANY($1::uuid[])", [[...ownedRuns]]);
        for (const run of runs) { ownedRuns.add(String(run.id)); await insert("DriveImportRun", run); }
        for (const row of results) await insert("DriveImportResult", row);
      };
      raw = async () => ({ runs: (await sql!.query("SELECT * FROM drive_import_runs ORDER BY id")).rows, results: (await sql!.query("SELECT * FROM drive_import_results ORDER BY id")).rows, audit: (await sql!.query("SELECT * FROM activity_changes ORDER BY id")).rows });
    } else {
      client = new MongoClient(MONGO_URI, { directConnection: true, serverSelectionTimeoutMS: 5000 }); await client.connect();
      const hello = await client.db("admin").command({ hello: 1 }); assert.equal(hello.setName, "drivehistory20260930"); assert.equal(hello.isWritablePrimary, true);
      databaseName = `hub_om_shadow_drive_parity_${randomBytes(8).toString("hex")}`;
      assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0); mongoOwned = true;
      const options = { client, databaseName, namespace: "shadow_drive_parity", allowShadowWrites: true as const };
      const product = await current<{ prepareMongoDriveImportHistory(o: typeof options): Promise<void>; MongoDriveImportHistoryRepository: { open(o: typeof options): Promise<Reader> } }>("src/lib/data/mongoDriveImportHistoryRepository.ts");
      await product.prepareMongoDriveImportHistory(options);
      const repo = await product.MongoDriveImportHistoryRepository.open(options);
      const context = await current<{ runWithDataRepositories<T>(repositories: Record<string, unknown>, work: () => T): T }>("src/lib/data/dataRepositoryContext.ts");
      const facade = await current<Reader>("src/lib/driveImports/driveImportResults.ts");
      api = { readLatestDriveImportRun: take => context.runWithDataRepositories({ driveImportHistory: repo }, () => facade.readLatestDriveImportRun(take)), readLatestDriveImportResult: id => context.runWithDataRepositories({ driveImportHistory: repo }, () => facade.readLatestDriveImportResult(id)) };
      const codec = await current<typeof import("../../../../src/lib/data/mongoRuntimeCodec")>("src/lib/data/mongoRuntimeCodec.ts");
      const { MongoOperationStore, completeMongoRow } = await current<typeof import("../../../../src/lib/data/mongoOperationStore")>("src/lib/data/mongoOperationStore.ts");
      const store = new MongoOperationStore(options, ["DriveImportRun", "DriveImportResult", "OperationSession"]);
      async function insert(model: string, input: Row) {
        const row = Object.fromEntries(Object.entries(input).map(([k,v]) => [k, v === DB_NULL ? codec.MongoDbNull : v === JSON_NULL ? codec.MongoJsonNull : v]));
        await store.collection(model).insertOne(codec.encodeMongoRuntimeDocument(model, completeMongoRow(model, row)));
        const actual = await store.collection(model).findOne({ _id: String(input.id) }); assert.ok(actual);
        const decoded = codec.decodeMongoRuntimeDocument(model, actual);
        for (const [key, value] of Object.entries(input)) {
          const v = decoded[key]; const normalized = v === codec.MongoDbNull || v === codec.MongoJsonNull ? null : v;
          assert.deepEqual(normalized, value === DB_NULL || value === JSON_NULL ? null : value, `seed ${model}.${key}`);
        }
      }
      seed = async (runs, results) => {
        await store.collection("DriveImportResult").deleteMany({}); await store.collection("DriveImportRun").deleteMany({});
        for (const run of runs) await insert("DriveImportRun", run);
        for (const row of results) await insert("DriveImportResult", row);
      };
      raw = async () => {
        const data: Row = {};
        for (const collection of await client!.db(databaseName).listCollections().toArray()) data[collection.name] = await client!.db(databaseName).collection(collection.name).find({}).sort({ _id: 1 }).toArray();
        return data;
      };
    }
    async function observe(name: string, work: () => Promise<unknown>, expected?: unknown, custom?: (value: unknown) => void) {
      const before = canonical(await raw()); const value = await work();
      if (custom) custom(value); else assertExact(value, expected);
      assert.equal(canonical(await raw()), before, `${name}: reader wrote data`);
      if (custom) await send({ kind: "allowed-choice", backend, name, value });
      await mark(name, custom ? "complete-allowed-set-pass" : value);
    }
    await seed([], []);
    await observe("empty-run", () => api.readLatestDriveImportRun(), null);
    await observe("empty-single", () => api.readLatestDriveImportResult("missing"), null);
    await seed([runSeed()], [resultSeed(1, richSeed)]);
    await observe("rich-full-run", () => api.readLatestDriveImportRun(), expectedRun([richRow]));
    await observe("rich-full-single", () => api.readLatestDriveImportResult(" Op-Exact "), richSingle);
    await observe("exact-id-no-trim", () => api.readLatestDriveImportResult("Op-Exact"), null);
    await observe("exact-id-no-casefold", () => api.readLatestDriveImportResult(" op-exact "), null);
    await seed([runSeed(1, { status: "COMPLETED", finishedAt: new Date("2032-02-04T12:34:56.789+09:00") })], [resultSeed(1, richSeed)]);
    await observe("selected-finishedAt-nonnull-whole-DTO", () => api.readLatestDriveImportRun(), expectedRun([richRow], {
      status: "COMPLETED", finishedAt: "2032-02-04T03:34:56.789Z"
    }));
    for (const [label, value] of [["db-null", DB_NULL], ["json-null", JSON_NULL], ["nonarray", { ignored: true }]] as const) {
      await seed([runSeed()], [resultSeed(1, { keyCandidates: value, folderCandidates: value, issues: value })]);
      await observe(`json-${label}`, () => api.readLatestDriveImportRun(), expectedRun([expectedRow()]));
    }
    await seed([runSeed(1, { startedAt: new Date(OLD), status: "COMPLETED", finishedAt: new Date(AT) }), runSeed(2, { startedAt: new Date(LATE), status: "FAILED" })], [resultSeed()]);
    await observe("latest-failed-empty-not-old-success", () => api.readLatestDriveImportRun(), expectedRun([], { id: runId(2), startedAt: LATE, status: "FAILED" }));
    await seed([runSeed(1, { startedAt: new Date(OLD), status: "COMPLETED" }), runSeed(2)], [resultSeed(1, { operationId: "shared", createdAt: new Date(LATE), inputValue: "old-run-new-result" }), resultSeed(2, { runId: runId(2), operationId: "shared", createdAt: new Date(OLD), inputValue: "new-run-old-result" }), resultSeed(3, { runId: runId(2), operationId: "shared", createdAt: new Date(AT), inputValue: "winner" })]);
    await observe("single-run-key-before-created-key", () => api.readLatestDriveImportResult("shared"), expectedSingle({ runId: runId(2), inputValue: "winner" }));
    await seed([runSeed()], [resultSeed(1, { operationId: "tie", inputValue: "left" }), resultSeed(2, { operationId: "tie", inputValue: "right" })]);
    await observe("single-tie-complete-candidate", () => api.readLatestDriveImportResult("tie"), undefined, value => assertOneComplete(value, [expectedSingle({ inputValue: "left" }), expectedSingle({ inputValue: "right" })]));
    await seed([runSeed(), runSeed(2, { status: "FAILED", operationCount: 777 })], [resultSeed(1, { inputValue: "left" }), resultSeed(2, { runId: runId(2), inputValue: "right" })]);
    await observe("run-tie-complete-candidate", () => api.readLatestDriveImportRun(), undefined, value => assertOneComplete(value, [expectedRun([expectedRow(1, { inputValue: "left" })]), expectedRun([expectedRow(2, { inputValue: "right" })], { id: runId(2), status: "FAILED", operationCount: 777 })]));
    // Each upper key beats a more favorable lower key; order is a literal list, not product sorting.
    const sorting = [{ candidateCount: 30, companyName: "z", courseName: "z" }, { candidateCount: 20, companyName: "a", courseName: "z" }, { candidateCount: 20, companyName: "b", courseName: "a" }, { candidateCount: 20, companyName: "b", courseName: "b" }, { candidateCount: 10, companyName: "A", courseName: "A" }];
    await seed([runSeed()], sorting.map((x,i) => resultSeed(i+1,x)).reverse());
    await observe("sort-key-priorities", () => api.readLatestDriveImportRun(), expectedRun(sorting.map((x,i) => expectedRow(i+1,x))));
    const utf8Order = ["", " ", "A", "Z", "a", "a-", "a0", "a10", "a2", "a\u0301", "z", "Ä", "á", "ä", "가", "각", "나", "\uE000", "\u{10000}"];
    await seed([runSeed()], utf8Order.map((name,i) => resultSeed(i+1, { companyName: name })).reverse());
    if (sql) {
      const bytes = (await sql.query("SELECT current_setting('client_encoding') AS client_encoding,company_name,encode(convert_to(company_name,'UTF8'),'hex') AS utf8_hex FROM drive_import_results WHERE company_name IN ($1,$2) ORDER BY company_name", ["\uE000", "\u{10000}"])).rows;
      assert.deepEqual(bytes.map(row => [row.company_name,row.utf8_hex]), [["\uE000","ee8080"],["\u{10000}","f0908080"]]);
      await send({kind:"evidence",backend,phase:"synthetic-SQL_ASCII-C-client-UTF8-bytes",rows:bytes});
    }
    await observe("captured-C-company-collation", () => api.readLatestDriveImportRun(), expectedRun(utf8Order.map((name,i) => expectedRow(i+1, { companyName: name }))));
    await seed([runSeed()], utf8Order.map((name,i) => resultSeed(i+1, { courseName: name })).reverse());
    await observe("captured-C-course-collation", () => api.readLatestDriveImportRun(), expectedRun(utf8Order.map((name,i) => expectedRow(i+1, { courseName: name }))));
    const ranked = Array.from({ length: 253 }, (_,i) => resultSeed(i+1, { candidateCount: 1000-i }));
    const rankedLiteral = Array.from({ length: 253 }, (_,i) => expectedRow(i+1, { candidateCount: 1000-i }));
    await seed([runSeed()], ranked);
    const takes: Array<{ label: string; value?: number; omit?: boolean; start?: number; end?: number; null?: boolean }> = [
      { label: "omitted", omit: true, end: 250 }, { label: "undefined", end: 250 },
      ...[0,1,249,250,251].map(n => ({ label: String(n), value: n, end: n })),
      { label: "negative-1", value: -1, start: 252 }, { label: "negative-250", value: -250, start: 3 },
      { label: "fraction", value: 1.5, end: 1 }, { label: "negative-fraction", value: -1.5, start: 252 },
      { label: "negative-250.9", value: -250.9, start: 3 },
      ...[0.5,-0.5,-0,1e-7].map((n,i) => ({ label: `zero-${i}`, value: n, end: 0 })),
      ...[2147483648,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER].map(n => ({ label: `safe-${n}`, value: n })),
      ...[Number.MAX_SAFE_INTEGER+1,-Number.MAX_SAFE_INTEGER-1,1e18,-1e18,1e20,Number.MAX_VALUE,NaN,Infinity,-Infinity].map(n => ({ label: `invalid-${n}`, value: n, null: true }))
    ];
    for (const c of takes) await observe(`take-${c.label}`, () => c.omit ? api.readLatestDriveImportRun() : api.readLatestDriveImportRun(c.value), c.null ? null : expectedRun(rankedLiteral.slice(c.start ?? 0,c.end)));
    // 249 mandatory rows plus three tied candidates: exact full DTO, count and multiplicity.
    await seed([runSeed()], [...ranked.slice(0,249), ...[250,251,252].map(i => resultSeed(i, { candidateCount: 1 }))]);
    const mandatory = rankedLiteral.slice(0,249), ties = [250,251,252].map(i => expectedRow(i, { candidateCount: 1 }));
    await observe("take-250-boundary-tie", () => api.readLatestDriveImportRun(), undefined, value => {
      const view = value as { results: Row[] }; assert.ok(view); assertExact({ ...view, results: [] },expectedRun([]));
      assertGroups(view.results,[...mandatory.map(row => ({ rows: [row],count:1 })),{ rows:ties,count:1 }]);
    });
    await observe("negative-tail-tie", () => api.readLatestDriveImportRun(-2), undefined,value => {
      const view=value as { results:Row[] };assert.ok(view);assertExact({...view,results:[]},expectedRun([]));assertGroups(view.results,[{rows:ties,count:2}]);
    });
    await seed([runSeed()], [resultSeed(1, { operationId:"duplicate" }),resultSeed(2,{ operationId:"duplicate" })]);
    await observe("identical-DTO-multiplicity", () => api.readLatestDriveImportRun(), expectedRun([expectedRow(1,{operationId:"duplicate"}),expectedRow(1,{operationId:"duplicate"})]));
    if (backend !== "mongo") {
      await seed([runSeed()], [resultSeed()]);
      delete process.env.DATABASE_URL;
      try { assertExact(await api.readLatestDriveImportRun(),null); assertExact(await api.readLatestDriveImportResult("op-1"),null); }
      finally { process.env.DATABASE_URL=PG_URL; }
      await mark("default-no-env-null");
      await sql!.query("ALTER TABLE drive_import_results RENAME TO parity_owned_results_unavailable");
      try { assertExact(await api.readLatestDriveImportRun(),null); assertExact(await api.readLatestDriveImportResult("op-1"),null); }
      finally { await sql!.query("ALTER TABLE parity_owned_results_unavailable RENAME TO drive_import_results"); }
      await mark("default-query-failure-null");
      await sql!.query("UPDATE drive_import_results SET folder_title='SYNTHETIC_INVALID_CIPHERTEXT' WHERE id=$1",[resultId(1)]);
      try { assertExact(await api.readLatestDriveImportRun(),null); assertExact(await api.readLatestDriveImportResult("op-1"),null); }
      finally { await sql!.query("UPDATE drive_import_results SET folder_title=NULL WHERE id=$1",[resultId(1)]); }
      await mark("default-decode-failure-null");
      // Explicit injection AFTER real delegate query + privacy decode, on one retrieved Date only.
      // No frozen bytes, product methods, Date.prototype, scope or database data are patched.
      await seed([runSeed(1, { finishedAt: new Date("2032-02-04T03:34:56.789Z") })], [resultSeed(1, richSeed)]);
      const globalPrisma = globalThis as unknown as { prisma?: PrismaClient };
      for (const delegateName of ["driveImportRun", "driveImportResult"] as const) {
        const actualClient = globalPrisma.prisma; assert.ok(actualClient); assert.equal(actualClient, prisma);
        const before = canonical(await raw());
        let queryCalls = 0, decodedResults = 0, conversionThrows = 0;
        let patchedDate: Date | undefined, originalDescriptor: PropertyDescriptor | undefined;
        globalPrisma.prisma = new Proxy(actualClient, {
          get(target, key) {
            const delegate = Reflect.get(target, key, target);
            if (key !== delegateName) return delegate;
            return new Proxy(delegate, {
              get(realDelegate, member) {
                const method = Reflect.get(realDelegate, member, realDelegate);
                if (member !== "findFirst") return method;
                return async (...args: unknown[]) => {
                  queryCalls++;
                  const row = await Reflect.apply(method, realDelegate, args) as Row | null;
                  assert.ok(row, "actual PG query must return a row before injection");
                  if (delegateName === "driveImportRun") {
                    assert.equal(row.notes, "SYNTHETIC_NOT_RETURNED_NOTES");
                    const rows = row.results as Row[]; assert.ok(Array.isArray(rows)); assert.equal(rows.length, 1);
                    assert.equal(rows[0].inputValue, "SYNTHETIC_INPUT");
                  } else assert.equal(row.inputValue, "SYNTHETIC_INPUT");
                  const date = row[delegateName === "driveImportRun" ? "finishedAt" : "createdAt"];
                  assert.ok(date instanceof Date);
                  assert.equal(date.toISOString(), delegateName === "driveImportRun" ? "2032-02-04T03:34:56.789Z" : AT);
                  decodedResults++;
                  patchedDate = date; originalDescriptor = Object.getOwnPropertyDescriptor(date, "toISOString");
                  Object.defineProperty(date, "toISOString", { configurable: true, value: () => {
                    conversionThrows++; throw new Error("SYNTHETIC_DTO_CONVERSION_CANARY");
                  } });
                  return row;
                };
              }
            });
          }
        });
        try {
          assertExact(delegateName === "driveImportRun" ? await api.readLatestDriveImportRun() : await api.readLatestDriveImportResult(" Op-Exact "), null);
        } finally {
          globalPrisma.prisma = actualClient;
          if (patchedDate) {
            if (originalDescriptor) Object.defineProperty(patchedDate, "toISOString", originalDescriptor);
            else Reflect.deleteProperty(patchedDate, "toISOString");
          }
        }
        assert.equal(queryCalls, 1); assert.equal(decodedResults, 1); assert.equal(conversionThrows, 1);
        assert.equal(canonical(await raw()), before, "Date injection changed database data");
        await mark(`default-dto-conversion-injection-${delegateName}-null`, {
          injection: "retrieved-Date-instance.toISOString after actual PG query/privacy decode", queryCalls, decodedResults, conversionThrows, result: null, databaseUnchanged: true
        });
      }
      await observe("default-conversion-restored-run", () => api.readLatestDriveImportRun(), expectedRun([richRow], { finishedAt: "2032-02-04T03:34:56.789Z" }));
      await observe("default-conversion-restored-single", () => api.readLatestDriveImportResult(" Op-Exact "), richSingle);
    }
    await send({ kind:"result", backend, ledger, note:"Every non-tie DTO independently equals literal; ties match complete allowed set. Current/native pair equality alone is not acceptance." });
  } finally {
    try { await prisma?.$disconnect(); }
    finally {
      try {
        if(sql) {
          try { if(pgOwned) { if(ownedRuns.size) await sql.query("DELETE FROM drive_import_runs WHERE id=ANY($1::uuid[])",[[...ownedRuns]]); assert.deepEqual((await sql.query("SELECT (SELECT count(*)::int FROM drive_import_runs) AS runs,(SELECT count(*)::int FROM drive_import_results) AS results")).rows,[{runs:0,results:0}]); await send({kind:"cleanup",backend,ownedRows:0}); } }
          finally { await sql.end(); }
        }
      } finally {
        if(client) { try { if(mongoOwned) { await client.db(databaseName).dropDatabase();assert.equal((await client.db(databaseName).listCollections().toArray()).length,0);await send({kind:"cleanup",backend,ownedCollections:0}); } } finally { await client.close(); } }
      }
    }
  }
}
main().catch(async error => { await send({kind:"failure",message:error instanceof Error?error.stack:String(error)});process.exitCode=1; });
