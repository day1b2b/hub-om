import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { MongoClient } from "mongodb";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

const companyBusinessInfo = { get: async () => null, update: async () => { throw new Error("unexpected"); } };
const requestActivity = { recordRequest: async () => {} };
mock.module("./mongoCompanyBusinessInfoRepository", { namedExports: { MongoCompanyBusinessInfoRepository: { open: async () => companyBusinessInfo } } });
mock.module("./mongoRequestAuditRepository", { namedExports: { MongoRequestAuditRepository: { open: async () => requestActivity } } });
const { openMongoCompanyBusinessInfoRuntime } = await import("./mongoCompanyBusinessInfoRuntime");

// withActivity는 요청을 시작하자마자 범위에서 requestActivity를 꺼낸다. 빠지면 사업자등록증
// 조회·저장·계산서 링크 요청이 처리 전에 모두 COMPANY_BUSINESS_INFO_COMPOSITION_FAILED로 실패했다.
test("business info runtime scope provides requestActivity for withActivity", async () => {
  const runtime = await openMongoCompanyBusinessInfoRuntime({ client: {} as MongoClient, databaseName: "db", namespace: "ns", allowShadowWrites: true });
  const seen = await runtime.run(async () => ({
    requestActivity: getDataRepositoryOverride("requestActivity"),
    companyBusinessInfo: getDataRepositoryOverride("companyBusinessInfo")
  }));
  assert.equal(seen.requestActivity, requestActivity);
  assert.equal(seen.companyBusinessInfo, companyBusinessInfo);
});
