import assert from "node:assert/strict";
import test from "node:test";
import { runCompanyBusinessInfoRequest, type CompanyBusinessInfoCompositionDependencies } from "./companyBusinessInfoComposition";

const key = Buffer.alloc(32, 1).toString("base64");
const indexKey = Buffer.alloc(32, 2).toString("base64");
// 사업자등록증 정보는 기업위키 화면(Company)과 같은 데이터라서, 그 화면을 여는
// overviewPagesComposition과 같은 플래그(OVERVIEW_PAGES_BACKEND)로 백엔드를 고른다.
const environment = {
  OVERVIEW_PAGES_BACKEND: "mongodb-shadow",
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  MONGODB_SHADOW_DATABASE: "hub_om_shadow_company_business_info",
  MONGODB_SHADOW_NAMESPACE: "shadow_company_business_info",
  PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: key }),
  PII_ACTIVE_KEY_ID: "fixture",
  PII_INDEX_KEY: indexKey
};

function fixture(failure?: string) {
  const seen: string[] = [];
  const dependencies: CompanyBusinessInfoCompositionDependencies = {
    createClient() {
      seen.push("client");
      return {
        async connect() { seen.push("connect"); if (failure === "connect") throw new Error("private"); },
        async close() { seen.push("close"); if (failure === "close") throw new Error("private"); }
      };
    },
    async openRuntime() {
      seen.push("open");
      if (failure === "open") throw new Error("private");
      return { async run<T>(work: () => Promise<T>) { seen.push("run"); return work(); } };
    }
  };
  const work = async () => { seen.push("work"); if (failure === "work") throw new Error("private"); return "ok"; };
  return { seen, dependencies, work };
}

test("company business info defaults to PostgreSQL", async () => {
  const f = fixture();
  assert.equal(await runCompanyBusinessInfoRequest(f.work, {}, f.dependencies), "ok");
  assert.deepEqual(f.seen, ["work"]);
});

test("exact Mongo selector owns one client", async () => {
  const f = fixture();
  assert.equal(await runCompanyBusinessInfoRequest(f.work, environment, f.dependencies), "ok");
  assert.deepEqual(f.seen, ["client", "connect", "open", "run", "work", "close"]);
});

test("invalid selector and configuration fail before client", async () => {
  for (const value of [
    { OVERVIEW_PAGES_BACKEND: "mongo" },
    { OVERVIEW_PAGES_BACKEND: "mongodb-shadow" },
    { ...environment, PII_INDEX_KEY: key }
  ]) {
    const f = fixture();
    await assert.rejects(runCompanyBusinessInfoRequest(f.work, value, f.dependencies), /COMPANY_BUSINESS_INFO_COMPOSITION_FAILED/);
    assert.deepEqual(f.seen, []);
  }
});

test("runtime failures close and redact", async () => {
  for (const failure of ["connect", "open", "work"]) {
    const f = fixture(failure);
    await assert.rejects(runCompanyBusinessInfoRequest(f.work, environment, f.dependencies), /COMPANY_BUSINESS_INFO_COMPOSITION_FAILED/);
    assert.equal(f.seen.at(-1), "close");
  }
});

test("cleanup failure preserves result", async () => {
  const f = fixture("close");
  assert.equal(await runCompanyBusinessInfoRequest(f.work, environment, f.dependencies), "ok");
});

test("Next control flow is preserved", async () => {
  for (const digest of ["NEXT_REDIRECT;replace;/sign-in;307;", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
    const control = Object.assign(new Error("control"), { digest });
    const f = fixture();
    await assert.rejects(runCompanyBusinessInfoRequest(async () => { throw control; }, environment, f.dependencies), (error) => error === control);
  }
});
