/** Drive history native 전용. 합성 seed와 독립 literal; 원천/PG/Calendar 연결 없음. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BSON, MongoClient, type CommandStartedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { MongoOperationStore, completeMongoRow, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, mongoRuntimeContracts, type MongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoDriveImportHistoryRepository, prepareMongoDriveImportHistory } from "./mongoDriveImportHistoryRepository";

export const DRIVE_HISTORY_URI = "mongodb://127.0.0.1:27850/?replicaSet=drivehistory20260930";
export const driveHistoryOptIn = process.env.MONGODB_DRIVE_HISTORY_TEST_URI;
export const HISTORY_MODELS = ["DriveImportRun", "DriveImportResult", "OperationSession"] as const;
export const KEYS = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
export const AT = "2099-01-02T03:04:05.006Z";
export const LATER = "2099-02-03T04:05:06.007Z";
export const OP = "synthetic-drive-operation";
export const CANARY = "synthetic-private-drive-history";
export const ERROR_CANARY = "mongodb://synthetic-secret@example.invalid/private";
export const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const RID = id(1), SID = id(2), DID = id(3);
export const ROW_LIMIT = 20_000, BYTE_LIMIT = 32 * 1024 * 1024;

export function runSeed(values: MongoRow = {}): MongoRow {
  return { id: RID, mode: "dry_run", status: "PENDING", operationCount: 101, scannedRefCount: 102,
    scanFoundFolderCount: 103, scanIssueCount: 104, folderSearchCount: 105, folderSearchWithCandidatesCount: 106,
    avgSatisfactionCandidateCount: 107, instructorSatisfactionCandidateCount: 108, instructorCandidateCount: 109,
    suspiciousCandidateCount: 110, errorCount: 111, summary: { marker: CANARY + "-summary" }, notes: CANARY + "-notes",
    startedAt: new Date(AT), finishedAt: null, ...values };
}
export function resultSeed(values: MongoRow = {}): MongoRow {
  return { id: DID, runId: RID, operationSessionId: null, operationId: OP, companyName: "합성 회사", courseName: "합성 과정",
    startDate: new Date("2099-01-01T00:00:00.000Z"), endDate: null, inputKind: "url", inputValue: CANARY + "-input",
    resultKind: "candidate", folderId: CANARY + "-folder-id", folderTitle: CANARY + "-title", folderUrl: "https://example.invalid/synthetic-folder",
    fileCount: 7, candidateCount: 9, keyCandidates: [null, false, 0, "x", {}, [], { value: { nested: ["kept"] }, extra: CANARY + "-key" }],
    folderCandidates: [{ title: CANARY + "-folder", unknownField: [1, true] }], issues: [null, 3, "", CANARY + "-issue"],
    error: CANARY + "-stored-error", createdAt: new Date(AT), ...values };
}
/** Session의 업무 의미는 부모 존재뿐. required filler는 seed 전용이며 DTO oracle에 사용하지 않는다. */
export function sessionSeed(values: MongoRow = {}): MongoRow {
  const row = completeMongoRow("OperationSession", { id: SID, operationId: "different-current-operation", ...values });
  for (const [name, field] of Object.entries(mongoRuntimeContracts.OperationSession.fields)) {
    if (Object.hasOwn(row, name) || name.endsWith("PiiIndex") || name.endsWith("Encrypted")) continue;
    row[name] = field.values ? field.values[0] : field.uuid ? id(90) : field.type === "DateTime" ? new Date(field.dateOnly ? "2099-01-02T00:00:00.000Z" : AT)
      : field.type === "Int" ? 0 : field.type === "Boolean" ? false : field.type === "Json" ? {} : `synthetic-${name}`;
  }
  return row;
}

// 원본 driveImportResults.ts return literal의 명시적 값. seed를 decode/map/filter해서 expected를 만들지 않는다.
export function singleLiteral(overrides: Document = {}): Document {
  return { candidateCount: 9, createdAt: AT, fileCount: 7, folderCandidates: [{ title: CANARY + "-folder", unknownField: [1, true] }],
    folderTitle: CANARY + "-title", folderUrl: "https://example.invalid/synthetic-folder", inputKind: "url", inputValue: CANARY + "-input",
    issues: ["", CANARY + "-issue"], keyCandidates: [{}, [], { value: { nested: ["kept"] }, extra: CANARY + "-key" }],
    resultKind: "candidate", runId: RID, runStartedAt: AT, runStatus: "PENDING", ...overrides };
}
export function resultLiteral(overrides: Document = {}): Document {
  return { candidateCount: 9, companyName: "합성 회사", courseName: "합성 과정", createdAt: AT, endDate: "", error: CANARY + "-stored-error",
    fileCount: 7, folderCandidates: [{ title: CANARY + "-folder", unknownField: [1, true] }], folderTitle: CANARY + "-title",
    folderUrl: "https://example.invalid/synthetic-folder", inputKind: "url", inputValue: CANARY + "-input", issues: ["", CANARY + "-issue"],
    keyCandidates: [{}, [], { value: { nested: ["kept"] }, extra: CANARY + "-key" }], operationId: OP, resultKind: "candidate", startDate: "2099-01-01", ...overrides };
}
export function runLiteral(results: Document[] = [resultLiteral()], overrides: Document = {}): Document {
  return { avgSatisfactionCandidateCount: 107, errorCount: 111, finishedAt: "", folderSearchCount: 105,
    folderSearchWithCandidatesCount: 106, id: RID, instructorCandidateCount: 109, instructorSatisfactionCandidateCount: 108,
    mode: "dry_run", operationCount: 101, results, scanFoundFolderCount: 103, scanIssueCount: 104, scannedRefCount: 102,
    startedAt: AT, status: "PENDING", suspiciousCandidateCount: 110, ...overrides };
}
export function historyFailure(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.message, "DRIVE_IMPORT_HISTORY_READ_FAILED");
  assert.equal(error.cause, undefined);
  for (const value of [CANARY, ERROR_CANARY]) {
    assert.ok(!String(error.stack).includes(value)); assert.ok(!JSON.stringify(error).includes(value));
  }
  return true;
}
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
export async function bounded<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Synthetic Drive barrier timeout")), ms);
  })]); } finally { clearTimeout(timer); }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => JSON.stringify(key) + ":" + canonical(child)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export function rawDigest(rows: Document[]): string {
  return createHash("sha256").update(canonical(rows.map(row => BSON.EJSON.serialize(row, { relaxed: false })))).digest("hex");
}
export function wireLedger(client: MongoClient, databaseName: string) {
  const commands: CommandStartedEvent[] = [], receipts: { collection: string; rows: number; bytes: number; keys: string[][] }[] = [];
  const requests = new Map<number, CommandStartedEvent>();
  const started = (event: CommandStartedEvent) => {
    if (event.databaseName !== databaseName && !["commitTransaction", "abortTransaction"].includes(event.commandName)) return;
    commands.push(event); requests.set(event.requestId, event);
  };
  const succeeded = (event: CommandSucceededEvent) => {
    const request = requests.get(event.requestId); if (!request) return;
    const reply = event.reply as Document;
    const rows: Document[] = reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? [];
    receipts.push({ collection: String(request.command.find ?? request.command.aggregate ?? request.commandName), rows: rows.length,
      bytes: rows.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0), keys: rows.map(row => Object.keys(row).sort()) });
  };
  client.on("commandStarted", started); client.on("commandSucceeded", succeeded);
  return { commands, receipts, get rows() { return receipts.reduce((sum, r) => sum + r.rows, 0); },
    get bytes() { return receipts.reduce((sum, r) => sum + r.bytes, 0); },
    stop() { client.off("commandStarted", started); client.off("commandSucceeded", succeeded); } };
}
export function assertReadWire(ledger: ReturnType<typeof wireLedger>) {
  const mutations = new Set(["insert", "update", "delete", "findAndModify", "create", "createIndexes", "dropIndexes", "collMod", "drop", "dropDatabase", "renameCollection", "bulkWrite"]);
  assert.deepEqual(ledger.commands.filter(c => mutations.has(c.commandName)).map(c => c.commandName), []);
  assert.deepEqual(ledger.commands.filter(c => ["listCollections", "listIndexes", "getMore"].includes(c.commandName)).map(c => c.commandName), []);
  for (const command of ledger.commands.filter(c => c.commandName === "find")) {
    // Installed mongodb/src/operations/find.ts: batchSize===limit이면 cursor를 남기지 않도록 wire batchSize에 +1.
    // 제품의 limit100과 실제 수신 상한100을 별도로 유지한다. 101행 수신을 허용하는 변경이 아니다.
    assert.equal(command.command.singleBatch, true); assert.equal(command.command.limit, 100);
    assert.equal(command.command.batchSize, 101);
    // formatSort()는 wire command에 순서 있는 Map을 넣는다. BSON document 표현도 같은 순서/방향으로 비교한다.
    const sort: unknown = command.command.sort;
    assert.ok(sort && typeof sort === "object" && !Array.isArray(sort));
    const entries = sort instanceof Map ? [...sort.entries()] : Object.entries(sort);
    assert.deepEqual(entries, [["_id", 1]]); assert.ok(command.command.lsid);
    assert.equal(command.command.autocommit, false);
  }
  assert.ok(ledger.receipts.every(receipt => receipt.rows <= 100), "각 실제 응답 batch는 limit100 이하여야 한다");
  const first = ledger.commands.find(c => c.commandName === "find");
  if (first) { assert.equal(first.command.startTransaction, true); assert.equal(first.command.readConcern?.level, "snapshot"); }
}

export async function driveHarness(work: (h: DriveHarness) => Promise<void>) {
  assert.equal(driveHistoryOptIn, DRIVE_HISTORY_URI, "Drive history 전용 endpoint exact opt-in 필요");
  const client = new MongoClient(DRIVE_HISTORY_URI, { monitorCommands: true, serverSelectionTimeoutMS: 3000 });
  const observer = new MongoClient(DRIVE_HISTORY_URI, { monitorCommands: true, serverSelectionTimeoutMS: 3000 });
  const databaseName = "hub_om_shadow_drive_" + randomBytes(12).toString("hex");
  const keys = { PII_ENCRYPTION_KEYS: JSON.stringify({ drive: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "drive",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  // 실제 값은 출력하지 않고 테스트 종료 때 원상복구한다.
  const saved = new Map(KEYS.map(name => [name, process.env[name]])); Object.assign(process.env, keys);
  let owned = false;
  const fixture = async (clock?: () => number) => {
    const options = { client, databaseName, namespace: "shadow_drive_" + randomBytes(10).toString("hex"), clock };
    await prepareMongoDriveImportHistory({ ...options, allowShadowWrites: true });
    const repo = await MongoDriveImportHistoryRepository.open(options);
    const store = new MongoOperationStore(options, HISTORY_MODELS);
    const seed = async (model: typeof HISTORY_MODELS[number], row: MongoRow) => {
      const raw = encodeMongoRuntimeDocument(model, row); await store.collection(model).insertOne(raw, { timeoutMS: 5000 }); return raw;
    };
    const seedPair = async (run: MongoRow = {}, result: MongoRow = {}) => {
      const runRaw = await seed("DriveImportRun", runSeed(run));
      const resultRaw = await seed("DriveImportResult", resultSeed(result));
      return { runRaw, resultRaw };
    };
    const snapshot = async () => {
      const result: Record<string, string> = {};
      const collections = await store.db.listCollections({ name: { $regex: "^" + options.namespace + "_" } }, { nameOnly: true, timeoutMS: 5000 }).toArray();
      for (const name of [...new Set([...collections.map(c => c.name), options.namespace + "_ActivityChange"])].sort()) {
        result[name] = rawDigest(await store.db.collection(name).find({}, { timeoutMS: 5000 }).sort({ _id: 1 }).toArray());
      }
      return result;
    };
    const readOnly = async <T>(read: () => Promise<T>) => {
      const before = await snapshot(), ledger = wireLedger(client, databaseName);
      let result!: T;
      const failures: unknown[] = [];
      try { result = await read(); }
      catch (error) { failures.push(error); }
      finally { ledger.stop(); }
      // 사후 wire/digest 오류가 본래 DTO/예외 assertion을 덮어쓰지 않도록 모두 보존한다.
      try { assertReadWire(ledger); } catch (error) { failures.push(error); }
      try { assert.deepEqual(await snapshot(), before); } catch (error) { failures.push(error); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Drive history read and readonly verification failed");
      return result;
    };
    return { options, repo, store, seed, seedPair, snapshot, readOnly };
  };
  try {
    await Promise.all([client.connect(), observer.connect()]);
    const hello = await client.db("admin").command({ hello: 1 }, { timeoutMS: 3000 });
    assert.equal(hello.setName, "drivehistory20260930"); assert.equal(typeof hello.logicalSessionTimeoutMinutes, "number");
    const existing = await client.db("admin").command({ listDatabases: 1, nameOnly: true, filter: { name: databaseName } }, { timeoutMS: 3000 });
    assert.equal(existing.databases.length, 0, "기존 DB 소유권 취득 금지");
    await client.db(databaseName).createCollection("synthetic_owner_" + randomUUID(), { timeoutMS: 3000 }); owned = true;
    console.info(JSON.stringify({ kind: "drive-history-owned-db", phase: "created", databaseName }));
    await work({ client, observer, databaseName, keys, fixture });
  } finally {
    try {
      if (owned) {
        // 다수 namespace/index의 fixture DB 정리는 제품 cursor/session의 5초 종료 계약과 별도다.
        // drop ACK와 실제 DB 부재 확인을 합쳐 30초 유한 예산. 실패는 로그 뒤 그대로 전파한다.
        const began = performance.now(), deadline = began + 30_000;
        const remaining = () => { const ms = Math.floor(deadline - performance.now()); assert.ok(ms > 0, "Owned DB cleanup deadline exceeded"); return ms; };
        console.info(JSON.stringify({ kind: "drive-history-owned-db", phase: "cleanup-start", databaseName, budgetMs: 30_000 }));
        try {
          await client.db(databaseName).dropDatabase({ timeoutMS: remaining() });
          const after = await client.db("admin").command({ listDatabases: 1, nameOnly: true, filter: { name: databaseName } }, { timeoutMS: Math.min(3000, remaining()) });
          assert.equal(after.databases.length, 0, "drop ACK만으로 정리 성공을 추정하지 않는다"); remaining();
          console.info(JSON.stringify({ kind: "drive-history-owned-db", phase: "cleanup-confirmed-absent", databaseName, elapsedMs: performance.now() - began }));
        } catch (error) {
          console.info(JSON.stringify({ kind: "drive-history-owned-db", phase: "cleanup-failed", databaseName, elapsedMs: performance.now() - began,
            errorName: error instanceof Error ? error.name : "UnknownError" }));
          throw error;
        }
      }
    }
    finally {
      try { await Promise.all([client.close(), observer.close()]); }
      finally { for (const name of KEYS) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    }
  }
}
export type DriveHarness = { client: MongoClient; observer: MongoClient; databaseName: string;
  keys: { PII_ENCRYPTION_KEYS: string; PII_ACTIVE_KEY_ID: string; PII_INDEX_KEY: string; PII_ALLOW_PLAINTEXT_READS: string };
  fixture: (clock?: () => number) => Promise<DriveFixture> };
export type DriveFixture = { options: { client: MongoClient; databaseName: string; namespace: string; clock?: () => number };
  repo: MongoDriveImportHistoryRepository; store: MongoOperationStore;
  seed: (model: typeof HISTORY_MODELS[number], row: MongoRow) => Promise<MongoRuntimeDocument>;
  seedPair: (run?: MongoRow, result?: MongoRow) => Promise<{ runRaw: MongoRuntimeDocument; resultRaw: MongoRuntimeDocument }>;
  snapshot: () => Promise<Record<string, string>>; readOnly: <T>(read: () => Promise<T>) => Promise<T> };

export async function pollOwnedOperation(observer: MongoClient, comment: string, wantActive: boolean, budgetMs: number) {
  const deadline = performance.now() + budgetMs;
  while (performance.now() < deadline) {
    const remaining = Math.floor(deadline - performance.now()); if (remaining <= 0) break;
    const reply = await observer.db("admin").command({ currentOp: 1, $all: true }, { timeoutMS: Math.min(300, remaining) });
    const owned: Document[] = reply.inprog.filter((op: Document) => op.command?.comment === comment);
    if (wantActive ? owned.some(op => op.active) : owned.length === 0) return;
    await sleep(Math.min(10, Math.max(0, deadline - performance.now())));
  }
  assert.fail(wantActive ? "owned pending operation을 timeout 전에 관찰하지 못함" : "cleanup 뒤 owned server operation 잔존");
}
