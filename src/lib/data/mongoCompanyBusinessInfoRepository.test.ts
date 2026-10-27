import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import { activityContext } from "../activity/context";
import * as readiness from "./mongoReadStore";
import { completeMongoRow, MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, type MongoRuntimeDocument } from "./mongoRuntimeCodec";

mock.module("./mongoReadStore", { namedExports: { ...readiness, assertMongoReadStoreReady: async () => {} } });
const { MongoCompanyBusinessInfoRepository } = await import("./mongoCompanyBusinessInfoRepository");
const saved = new Map(["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY"].map((key) => [key, process.env[key]]));

test("CompanyBusinessInfo: 조회·부분 저장·빈 값 삭제·없는 companyId·PII 평문 미저장", async () => {
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");

  const companies = new Map<string, MongoRuntimeDocument>();
  const activityChanges: MongoRuntimeDocument[] = [];
  const companyId = randomUUID();
  const now = new Date();
  const seed = completeMongoRow("Company", {
    id: companyId,
    name: "샘플전자",
    normalizedName: "샘플전자",
    createdAt: now,
    updatedAt: now,
    businessNumber: "1234567890",
    representativeName: "홍길동"
  });
  companies.set(companyId, encodeMongoRuntimeDocument("Company", seed));

  const one = mock.method(MongoOperationStore.prototype, "one", async (model: string, filter: MongoRow) => {
    assert.equal(model, "Company");
    const doc = companies.get((filter as { _id: string })._id);
    return doc ? decodeMongoRuntimeDocument("Company", doc) : null;
  });
  const collection = mock.method(MongoOperationStore.prototype, "collection", (model: string) => {
    if (model === "Company") {
      return {
        replaceOne: async (where: { _id: string }, doc: MongoRuntimeDocument) => {
          if (!companies.has(where._id)) return { matchedCount: 0 };
          companies.set(where._id, doc);
          return { matchedCount: 1 };
        }
      } as unknown as ReturnType<MongoOperationStore["collection"]>;
    }
    if (model === "ActivityChange") {
      return {
        insertOne: async (doc: MongoRuntimeDocument) => { activityChanges.push(doc); }
      } as unknown as ReturnType<MongoOperationStore["collection"]>;
    }
    throw new Error(`unexpected model ${model}`);
  });

  const session = { withTransaction: async (work: () => Promise<unknown>) => work(), endSession: async () => {} };
  const options = {
    client: {
      db: () => ({ command: async () => ({ setName: "fixture", logicalSessionTimeoutMinutes: 30 }) }),
      startSession: () => session
    } as unknown as MongoClient,
    databaseName: "hub_om_shadow_company_mock",
    namespace: "shadow_company",
    allowShadowWrites: true as const
  };

  try {
    await assert.rejects(
      MongoCompanyBusinessInfoRepository.open({ ...options, allowShadowWrites: false as unknown as true }),
      /SHADOW_WRITE_GATE/
    );

    const repository = await MongoCompanyBusinessInfoRepository.open(options);

    // 조회
    const found = await repository.get(companyId);
    assert.equal(found?.businessNumber, "1234567890");
    assert.equal(found?.representativeName, "홍길동");

    // 없는 companyId
    assert.equal(await repository.get(randomUUID()), null);
    await assert.rejects(
      repository.update(randomUUID(), { businessNumber: "9999999999" }, "om@day1company.co.kr"),
      /COMPANY_NOT_FOUND/
    );

    // 부분 저장: 보낸 필드만 바뀌고 나머지는 유지된다
    await activityContext.run(
      {
        requestId: "00000000-0000-4000-8000-000000000001",
        route: "/api/company-wiki/business-info",
        method: "POST",
        actorEmail: "om@day1company.co.kr",
        actorName: "OM",
        actorType: "user"
      },
      () => repository.update(companyId, { address: "서울시 강남구" }, "om@day1company.co.kr")
    );
    const afterPartial = await repository.get(companyId);
    assert.equal(afterPartial?.address, "서울시 강남구");
    assert.equal(afterPartial?.businessNumber, "1234567890");
    assert.equal(afterPartial?.businessInfoUpdatedBy, "om@day1company.co.kr");

    // 빈 값은 지운다(null)
    await repository.update(companyId, { businessNumber: "" }, "om@day1company.co.kr");
    assert.equal((await repository.get(companyId))?.businessNumber, null);

    // PII는 평문으로 저장되지 않는다
    const stored = [...companies.values()];
    assert.ok(!JSON.stringify(stored).includes("홍길동"));
    assert.ok(!JSON.stringify(stored).includes("서울시 강남구"));

    // 감사 로그가 남지만 PII는 redacted 처리된다(Company는 name만 평문 허용)
    assert.ok(activityChanges.length > 0);
    assert.ok(!JSON.stringify(activityChanges).includes("서울시 강남구"));
  } finally {
    for (const handle of [one, collection]) handle.mock.restore();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("CompanyBusinessInfo refuses a standalone Mongo server", async () => {
  const client = { db: () => ({ command: async () => ({ logicalSessionTimeoutMinutes: 30 }) }) } as unknown as MongoClient;
  await assert.rejects(
    MongoCompanyBusinessInfoRepository.open({
      client,
      databaseName: "hub_om_shadow_company_mock",
      namespace: "shadow_company",
      allowShadowWrites: true
    }),
    /TRANSACTIONS_REQUIRED/
  );
});

test("CompanyBusinessInfo open never exposes raw connection failures", async () => {
  const client = {
    db: () => ({
      command: async () => { throw new Error("synthetic-secret@example.invalid"); }
    })
  } as unknown as MongoClient;
  await assert.rejects(
    MongoCompanyBusinessInfoRepository.open({
      client,
      databaseName: "hub_om_shadow_company_mock",
      namespace: "shadow_company",
      allowShadowWrites: true
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /COMPANY_BUSINESS_INFO_OPEN_FAILED/);
      assert.ok(!error.message.includes("example.invalid"));
      return true;
    }
  );
});
