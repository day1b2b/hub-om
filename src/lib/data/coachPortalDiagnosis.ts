import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";
import { mongoFailureCode } from "./mongoOperationPrimitives";
import type { MongoOperationOptions } from "./mongoOperationStore";

// 코치 본인 포털(/api/coach/*)이 Mongo shadow runtime을 왜 못 여는지 확인하는 읽기 전용 진단.
// runCoachPortalRequest는 실패 원인을 COACH_PORTAL_COMPOSITION_FAILED 하나로 덮으므로, 같은 단계를 나눠서 다시 밟는다.
// prepare는 절대 호출하지 않는다: collection 조회·문서 수·인덱스 조회와 저장소 open(문서상 읽기 전용)만 한다.

export const COACH_BACKEND_SELECTORS = ["COACH_PORTAL_BACKEND", "COACH_MANAGEMENT_BACKEND", "COACH_PUBLIC_BACKEND", "CHANGES_BACKEND"] as const;

export interface DiagnosisStep { label: string; ok: boolean; code: string }
export interface DiagnosisCollection { model: string; exists: boolean; documents: number | null; ok: boolean; code: string }
export interface CoachPortalDiagnosis {
  selectors: { name: string; value: string }[];
  steps: DiagnosisStep[];
  collections: DiagnosisCollection[];
}

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
export interface CoachPortalDiagnosisDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  models(): Promise<readonly string[]>;
  inspectCollection(options: MongoOperationOptions, model: string): Promise<{ exists: boolean; documents: number | null }>;
  checkCollection(options: MongoOperationOptions, model: string): Promise<void>;
  checks(): Promise<{ label: string; run(options: MongoOperationOptions): Promise<void> }[]>;
}

const defaults: CoachPortalDiagnosisDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  models: async () => (await import("./mongoCoachPortalRuntime")).MONGO_COACH_PORTAL_RUNTIME_MODELS,
  inspectCollection: async (options, model) => {
    const { MongoOperationStore } = await import("./mongoOperationStore");
    const store = new MongoOperationStore(options, [model]);
    const collection = store.collection(model);
    const exists = !!await store.db.listCollections({ name: collection.collectionName }, { nameOnly: true }).next();
    return { exists, documents: exists ? await collection.estimatedDocumentCount({ maxTimeMS: 5_000 }) : null };
  },
  checkCollection: async (options, model) => {
    const [{ MongoOperationStore }, { assertMongoReadStoreReady }] = await Promise.all([import("./mongoOperationStore"), import("./mongoReadStore")]);
    await assertMongoReadStoreReady(new MongoOperationStore(options, [model]));
  },
  checks: async () => {
    const [{ MongoOperationStore }, guard, token, schedule, audit] = await Promise.all([
      import("./mongoOperationStore"), import("./mongoCoachSchedulingGuard"), import("./mongoCoachTokenRepository"),
      import("./mongoCoachScheduleRepository"), import("./mongoRequestAuditRepository"),
    ]);
    // 각 open은 운영 runtime과 똑같은 준비 상태 검사를 하고, 저장은 하지 않는다(allowShadowWrites는 open 게이트 통과용).
    return [
      { label: "예약 잠금 collection", run: async options => { await guard.assertMongoCoachSchedulingGuardReady(new MongoOperationStore(options, ["Coach"])); } },
      { label: "코치 토큰 저장소 열기", run: async options => { await token.MongoCoachTokenRepository.open(options); } },
      { label: "코치 일정 저장소 열기", run: async options => { await schedule.MongoCoachScheduleRepository.open({ ...options, allowShadowWrites: true }); } },
      { label: "요청 감사 저장소 열기", run: async options => { await audit.MongoRequestAuditRepository.open({ ...options, allowShadowWrites: true }); } },
    ];
  },
};

// requireMongoShadowComposition은 namespace·암호화 키 실패를 소문자 고정 문구로 던진다(값은 담기지 않음).
function compositionFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "configuration") return "SHADOW_NAMESPACE_INVALID";
  if (message === "privacy") return "PII_KEYS_INVALID";
  return mongoFailureCode(error);
}

function selectorValue(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "(미설정 → postgres)";
  return /^[a-z0-9-]{1,40}$/.test(trimmed) ? trimmed : "(형식 이상)";
}

export async function diagnoseCoachPortal(
  environment: MongoCompositionEnvironment = process.env,
  dependencies: CoachPortalDiagnosisDependencies = defaults
): Promise<CoachPortalDiagnosis> {
  const result: CoachPortalDiagnosis = {
    selectors: COACH_BACKEND_SELECTORS.map(name => ({ name, value: selectorValue(environment[name]) })),
    steps: [],
    collections: [],
  };
  const step = (label: string, ok: boolean, code = "OK") => { result.steps.push({ label, ok, code }); return ok; };

  const backend = environment.COACH_PORTAL_BACKEND?.trim() || "postgres";
  if (backend !== "mongodb-shadow") {
    step("포털 저장소 선택", backend === "postgres", backend === "postgres" ? "POSTGRES" : "UNKNOWN_BACKEND");
    return result;
  }

  let options: MongoOperationOptions;
  let client: Client | undefined;
  try {
    let shadow: { databaseName: string; namespace: string };
    try { shadow = requireMongoShadowComposition(environment); }
    catch (error) { step("Mongo 설정(namespace·암호화 키·URI)", false, compositionFailureCode(error)); return result; }
    step("Mongo 설정(namespace·암호화 키·URI)", true);

    try { client = dependencies.createClient(environment); await client.connect(); }
    catch (error) { step("Mongo 연결", false, mongoFailureCode(error)); return result; }
    step("Mongo 연결", true);
    options = { client: client as unknown as MongoClient, ...shadow };

    for (const model of await dependencies.models()) {
      const row: DiagnosisCollection = { model, exists: false, documents: null, ok: false, code: "OK" };
      try { Object.assign(row, await dependencies.inspectCollection(options, model)); }
      catch (error) { row.code = mongoFailureCode(error); result.collections.push(row); continue; }
      try { await dependencies.checkCollection(options, model); row.ok = true; }
      catch (error) { row.code = mongoFailureCode(error); }
      result.collections.push(row);
    }

    for (const check of await dependencies.checks()) {
      try { await check.run(options); step(check.label, true); }
      catch (error) { step(check.label, false, mongoFailureCode(error)); }
    }
    return result;
  } finally {
    if (client) try { await client.close(); } catch {}
  }
}
