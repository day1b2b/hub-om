import { randomBytes } from "node:crypto";
import { decodePrivateJson, encodePrivateJson } from "../privacy/crypto";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, writeFile, stat, chmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LocalJsonOperationRepository } from "./localJsonOperationRepository";
import { operationCreationIdentity, OperationCreationConflict } from "./operationCreationIdentity";
import type { CreateOperationInput } from "./operationTypes";

function input(): CreateOperationInput {
  const empty = Object.fromEntries(["coach", "companyWikiLink", "costRaw", "driveLink", "educationDays", "instructorWikiLink", "instructors", "ld", "lectureManagementLink", "om", "operationDetail", "operationIssue", "padletLink", "region", "resultReportLink", "specialNotes", "timeText"].map((key) => [key, ""]));
  return { ...empty, companyName: "Fixture", courseName: "Fixture course", courseId: "fixture", roundNo: "1",
    startDate: "2026-09-21", endDate: "2026-09-21", archiveStatus: "아카이빙전", operationStatus: "배정필요",
    operationType: "검토필요", educationFormat: "오프라인", onsiteRequired: "N", revenue: null, totalCost: null,
    instructorCost: null, operationCost: null,
    creationIdentity: operationCreationIdentity("fixture-creation-key:0", "a@example.test", "/api/operations", { fixture: true })
  } as CreateOperationInput;
}

const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
type Payload = { operations: Array<{ operationId: string }>; creationReceipts: Record<string, string> };
async function fixture(run: (repo: LocalJsonOperationRepository, file: string) => Promise<void>) {
  const cwd = process.cwd();
  const original = Object.fromEntries(envNames.map(key => [key, process.env[key]]));
  const root = await mkdtemp(path.join(tmpdir(), "hub-om-encrypted-creation-"));
  process.chdir(root);
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  try {
    await mkdir(path.join(root, ".local"));
    await run(new LocalJsonOperationRepository("operations.json"), path.join(root, ".local", "operations.json"));
  } finally {
    process.chdir(cwd);
    for (const key of envNames) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
    await rm(root, { recursive: true, force: true });
  }
}
async function payload(file: string): Promise<Payload> {
  const raw = await readFile(file, "utf8");
  assert.ok(raw.startsWith("pii:v1:"));
  assert.ok(!raw.includes("fixture edit") && !raw.includes("Fixture"));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  return decodePrivateJson(raw.trimEnd(), "local:operations") as Payload;
}

test("암호화 파일에서도 동시 재시도·재시작·수정·삭제 이후 등록 이력을 보존한다", async () => fixture(async (repo, file) => {
  const [first, second] = await Promise.all([repo.createOperation(input()), new LocalJsonOperationRepository(".local/./operations.json").createOperation(input())]);
  assert.equal(first.operationId, second.operationId);
  assert.equal(second.creationReplayed, true);
  assert.equal((await repo.listOperations()).length, 1);
  const receipts = (await payload(file)).creationReceipts;
  assert.equal(Object.keys(receipts).length, 1);
  assert.equal(receipts[input().creationIdentity!.scope], first.operationId);
  const restarted = new LocalJsonOperationRepository("operations.json");
  assert.equal((await restarted.createOperation(input())).creationReplayed, true);
  const changed = { ...input(), creationIdentity: operationCreationIdentity("fixture-creation-key:0", "a@example.test", "/api/operations", { fixture: false }) };
  await assert.rejects(repo.createOperation(changed), OperationCreationConflict);
  await repo.updateOperation(first.operationId, { specialNotes: "fixture edit" });
  assert.deepEqual((await payload(file)).creationReceipts, receipts);
  assert.equal((await restarted.createOperation(input())).specialNotes, "fixture edit");
  const unrelated = await repo.createOperation({ ...input(), creationIdentity: undefined });
  await repo.deleteOperation(unrelated.operationId);
  assert.deepEqual((await payload(file)).creationReceipts, receipts);
  await repo.deleteOperation(first.operationId);
  await assert.rejects(restarted.createOperation(input()), OperationCreationConflict);
  assert.deepEqual((await payload(file)).creationReceipts, receipts);
  assert.equal((await repo.listOperations()).length, 0);
  assert.deepEqual(await readdir(path.dirname(file)), ["operations.json"]);
}));

for (const shape of ["array", "object", "receipts"] as const) test(`legacy ${shape}: 허용된 평문을 읽고 수정 시 전체 암호화`, async () => fixture(async (repo, file) => {
  const first = await repo.createOperation(input());
  const saved = await payload(file);
  const legacy = shape === "array" ? saved.operations : shape === "object" ? { operations: saved.operations } : saved;
  await writeFile(file, JSON.stringify(legacy));
  await chmod(file, 0o644);
  process.env.PII_ALLOW_PLAINTEXT_READS = "true";
  assert.equal((await repo.listOperations())[0].operationId, first.operationId);
  await repo.updateOperation(first.operationId, { specialNotes: "fixture edit" });
  assert.deepEqual((await payload(file)).creationReceipts, saved.creationReceipts);
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  assert.equal((await repo.listOperations()).length, 1);
}));

test("평문 읽기 비허용 및 쓰기 키 누락은 원본을 바꾸지 않는다", async () => fixture(async (repo, file) => {
  const raw = JSON.stringify({ operations: [] });
  await writeFile(file, raw);
  await assert.rejects(repo.listOperations());
  await assert.rejects(repo.createOperation(input()));
  assert.equal(await readFile(file, "utf8"), raw);
  process.env.PII_ALLOW_PLAINTEXT_READS = "true";
  delete process.env.PII_ACTIVE_KEY_ID;
  await assert.rejects(repo.createOperation(input()));
  assert.equal(await readFile(file, "utf8"), raw);
  assert.deepEqual(await readdir(path.dirname(file)), ["operations.json"]);
}));

for (const failure of ["key", "aad", "tamper"] as const) test(`${failure} 오류 시 모든 쓰기 거부·원본 보존·이후 복구`, async () => fixture(async (repo, file) => {
  const first = await repo.createOperation(input());
  const good = await readFile(file, "utf8");
  const saved = await payload(file);
  const keys = process.env.PII_ENCRYPTION_KEYS;
  if (failure === "key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  if (failure === "aad") await writeFile(file, encodePrivateJson(saved, "local:team-users"));
  if (failure === "tamper") {
    const parts = good.trimEnd().split(":");
    parts[5] = (parts[5][0] === "A" ? "B" : "A") + parts[5].slice(1);
    await writeFile(file, parts.join(":"));
  }
  const damaged = await readFile(file, "utf8");
  await assert.rejects(repo.listOperations());
  await assert.rejects(repo.createOperation(input()));
  await assert.rejects(repo.updateOperation(first.operationId, { specialNotes: "fixture edit" }));
  await assert.rejects(repo.deleteOperation(first.operationId));
  assert.equal(await readFile(file, "utf8"), damaged);
  process.env.PII_ENCRYPTION_KEYS = keys;
  await writeFile(file, good);
  assert.equal((await repo.createOperation(input())).creationReplayed, true);
}));

for (const invalid of [null, [], "bad", { invalid: "id" }, { ["a".repeat(64)]: "manual-request-" + "b".repeat(64) + "-" + "c".repeat(64) }]) {
  test(`손상된 receipt ${JSON.stringify(invalid)} 거부`, async () => fixture(async (repo, file) => {
    await writeFile(file, encodePrivateJson({ operations: [], creationReceipts: invalid }, "local:operations"));
    const before = await readFile(file, "utf8");
    await assert.rejects(repo.listOperations());
    await assert.rejects(repo.createOperation(input()));
    await assert.rejects(repo.deleteOperation("missing"));
    assert.equal(await readFile(file, "utf8"), before);
  }));
}

test("다른 파일의 등록 이력은 독립이며 파일별 직렬화에서 새 요청을 잃지 않는다", async () => fixture(async (repo, file) => {
  const inputs = [0, 1, 2].map(n => ({ ...input(), creationIdentity: operationCreationIdentity(`fixture-parallel:${n}`, "a@example.test", "/api/operations", { n }) }));
  await Promise.all(inputs.map((value, i) => new LocalJsonOperationRepository(i % 2 ? ".local/./operations.json" : "operations.json").createOperation(value)));
  assert.equal((await repo.listOperations()).length, 3);
  assert.equal(Object.keys((await payload(file)).creationReceipts).length, 3);
  const other = new LocalJsonOperationRepository("other.json");
  assert.equal((await other.createOperation(inputs[0])).creationReplayed, undefined);
  await repo.deleteOperation((await repo.listOperations())[0].operationId);
  assert.equal((await other.listOperations()).length, 1);
}));

for (const shape of ["array", "object"] as const) test(`legacy ${shape}의 유실된 receipt를 기존 요청 ID로 복구하고 중복을 막는다`, async () => fixture(async (repo, file) => {
  const first = await repo.createOperation(input());
  const saved = await payload(file);
  const legacy = shape === "array" ? saved.operations : { operations: saved.operations };
  await writeFile(file, encodePrivateJson(legacy, "local:operations"));
  const changed = { ...input(), creationIdentity: operationCreationIdentity("fixture-creation-key:0", "a@example.test", "/api/operations", { fixture: false }) };
  const before = await readFile(file, "utf8");
  await assert.rejects(repo.createOperation(changed), OperationCreationConflict);
  assert.equal(await readFile(file, "utf8"), before);
  const replay = await repo.createOperation(input());
  assert.equal(replay.operationId, first.operationId);
  assert.equal(replay.creationReplayed, true);
  assert.equal((await repo.listOperations()).length, 1);
  assert.equal((await payload(file)).creationReceipts[input().creationIdentity!.scope], first.operationId);
  await repo.deleteOperation(first.operationId);
  await assert.rejects(repo.createOperation(input()), OperationCreationConflict);
}));

test("이미 중복된 legacy 요청 행은 임의 선택하거나 덮어쓰지 않는다", async () => fixture(async (repo, file) => {
  await repo.createOperation(input());
  const saved = await payload(file);
  await writeFile(file, encodePrivateJson({ operations: [...saved.operations, ...saved.operations] }, "local:operations"));
  const before = await readFile(file, "utf8");
  await assert.rejects(repo.createOperation(input()), OperationCreationConflict);
  assert.equal(await readFile(file, "utf8"), before);
}));

test("legacy 행을 재시도 전에 삭제해도 생성 이력을 복구해 재생성을 막는다", async () => fixture(async (repo, file) => {
  const first = await repo.createOperation(input());
  const saved = await payload(file);
  await writeFile(file, encodePrivateJson({ operations: saved.operations }, "local:operations"));
  await repo.deleteOperation(first.operationId);
  assert.equal((await payload(file)).creationReceipts[input().creationIdentity!.scope], first.operationId);
  await assert.rejects(new LocalJsonOperationRepository("operations.json").createOperation(input()), OperationCreationConflict);
  assert.equal((await repo.listOperations()).length, 0);
}));
