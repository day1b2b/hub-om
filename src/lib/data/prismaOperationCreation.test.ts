import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { randomBytes } from "node:crypto";
import { creationOperationId, creationOperationPrefix, operationCreationIdentity, OperationCreationConflict } from "./operationCreationIdentity";
import type { CreateOperationInput, OperationSession } from "./operationTypes";

const { withPrivacyDatabase } = await import("../privacy/database");
const { decryptField } = await import("../privacy/fields");
const { isEncrypted } = await import("../privacy/crypto");
let usePrivacy = false;
let stored: ({ operationId: string; deletedAt: Date | null } & Record<string, unknown>) | null = null;
const events: string[] = [];
const tx = {
  $queryRaw: async (sql: TemplateStringsArray, lockKey: bigint) => { assert.match(sql.join("?"), /pg_advisory_xact_lock/); assert.equal(typeof lockKey, "bigint"); events.push("lock"); },
  operationSession: {
    findFirst: async ({ where }: { where: { operationId: { startsWith: string } } }) => { assert.equal(where.operationId.startsWith, creationOperationPrefix(identity)); events.push("lookup"); return stored; },
    create: async ({ data }: { data: { operationId: string } }) => { events.push("create"); stored = { ...data, deletedAt: null }; return stored; }
  },
  company: { upsert: async () => { events.push("company"); return { id: "fixture-company" }; } },
  course: { upsert: async () => { events.push("course"); return { id: "fixture-course" }; } }
};
const rawClient = { operationSession: { findFirst: async ({ where }: { where: { operationId: string; deletedAt: null } }) => {
  assert.equal(where.deletedAt, null, "single-row replay lookup must exclude soft-deleted rows");
  assert.equal(where.operationId, stored?.operationId);
  return stored?.deletedAt ? null : stored;
} }, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
mock.module("./prisma", { namedExports: { getPrismaClient: () => usePrivacy ? withPrivacyDatabase(rawClient) : rawClient } });
mock.module("./prismaTeamMemberRepository", { namedExports: { PrismaTeamMemberRepository: class { async listRoleRosters() { return { ld: {}, om: {} }; } } } });
const { PrismaOperationRepository } = await import("./prismaOperationRepository");
const repository = new PrismaOperationRepository();
mock.method(repository, "getOperationById", async (operationId: string) => ({ operationId } as OperationSession));
const identity = operationCreationIdentity("fixture-creation-key:0", "a@example.test", "/api/operations", {})!;
function input(): CreateOperationInput {
  return new Proxy({ companyName: "Fixture", courseName: "Fixture", courseId: "fixture", startDate: "2026-09-21", endDate: "2026-09-21",
    creationIdentity: identity, educationDates: [], archiveStatus: "아카이빙전", operationStatus: "배정필요", operationType: "검토필요", educationFormat: "오프라인", onsiteRequired: "N", revenue: null
  }, { get: (value, name) => name in value ? Reflect.get(value, name) : "" }) as unknown as CreateOperationInput;
}
beforeEach(() => { stored = null; events.length = 0; usePrivacy = false; });
test("Prisma는 같은 transaction의 잠금→조회 후 생성하고 재전송은 회사/과정을 다시 수정하지 않는다", async () => {
  const first = await repository.createOperation(input());
  assert.deepEqual(events, ["lock", "lookup", "company", "course", "create"]);
  events.length = 0;
  const replay = await repository.createOperation(input());
  assert.equal(replay.operationId, first.operationId);
  assert.equal(replay.creationReplayed, true);
  assert.deepEqual(events, ["lock", "lookup"]);
});
test("같은 범위에서 본문이 다르거나 삭제된 행이면 아무 write 없이 거부한다", async () => {
  for (const existing of [{ operationId: "different-fingerprint", deletedAt: null }, { operationId: creationOperationId(identity), deletedAt: new Date() }]) {
    stored = existing;
    events.length = 0;
    await assert.rejects(repository.createOperation(input()), OperationCreationConflict);
    assert.deepEqual(events, ["lock", "lookup"]);
  }
});

const savedPrivacy = Object.fromEntries(["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"].map(key => [key, process.env[key]]));
after(() => { for (const [key, value] of Object.entries(savedPrivacy)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
test("암호화 transaction adapter에서도 요청 잠금·ID 조회를 유지하고 개인정보를 암호화한 채 재생한다", async () => {
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  usePrivacy = true;
  const createInput = { ...input(), om: "가상 담당", createdBy: "fixture@example.invalid" };
  // Preserve the Proxy defaults used by the minimal operation fixture.
  const payload = new Proxy(createInput, { get: (value, name) => name in value ? Reflect.get(value, name) : "" }) as CreateOperationInput;
  const first = await repository.createOperation(payload);
  assert.deepEqual(events, ["lock", "lookup", "company", "course", "create"]);
  const ciphertextRow = stored as unknown as Record<string, unknown>;
  assert.equal(ciphertextRow.operationId, creationOperationId(identity));
  assert.ok(isEncrypted(ciphertextRow.omName));
  assert.ok(isEncrypted(ciphertextRow.createdBy));
  assert.equal(decryptField("OperationSession", "omName", ciphertextRow.omName), "가상 담당");
  assert.equal(decryptField("OperationSession", "createdBy", ciphertextRow.createdBy), "fixture@example.invalid");
  events.length = 0;
  const replay = await repository.createOperation(payload);
  assert.equal(replay.operationId, first.operationId);
  assert.equal(replay.creationReplayed, true);
  assert.deepEqual(events, ["lock", "lookup"]);
  assert.equal(stored, ciphertextRow);
});


test("실제 getOperationById는 soft-delete된 영수증 행을 null로 반환한다", async () => {
  stored = { operationId: creationOperationId(identity), deletedAt: new Date() };
  const actualReadRepository = new PrismaOperationRepository();
  assert.equal(await actualReadRepository.getOperationById(stored.operationId), null);
  assert.deepEqual(events, []);
});
