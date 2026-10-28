import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";
import { mongoFailureCode } from "./mongoOperationPrimitives";
import type { MongoOperationOptions } from "./mongoOperationStore";

// 코치 본인 포털(/api/coach/*)이 Mongo shadow runtime을 왜 못 여는지 확인하는 진단.
// runCoachPortalRequest는 실패 원인을 COACH_PORTAL_COMPOSITION_FAILED 하나로 덮으므로, 같은 단계를 나눠서 다시 밟는다.
// diagnoseCoachPortal은 읽기 전용이다: collection 조회·문서 수·인덱스 조회와 저장소 open(문서상 읽기 전용)만 한다.
// 쓰기는 repairActiveReservationIndex 하나뿐이며 활성 예약 인덱스 1개만 만든다(문서 변경 없음).

export const COACH_BACKEND_SELECTORS = ["COACH_PORTAL_BACKEND", "COACH_MANAGEMENT_BACKEND", "COACH_PUBLIC_BACKEND", "CHANGES_BACKEND"] as const;
export const SCHEDULE_OPEN_LABEL = "코치 일정 저장소 열기";

export interface DiagnosisStep { label: string; ok: boolean; code: string }
export interface DiagnosisCollection { model: string; exists: boolean; documents: number | null; ok: boolean; code: string }
export interface CoachPortalDiagnosis {
  selectors: { name: string; value: string }[];
  steps: DiagnosisStep[];
  collections: DiagnosisCollection[];
  /** 같은 코치·같은 날짜의 취소 안 된 예약 묶음 수. 0이어야 활성 예약 인덱스를 만들 수 있다. 확인 못 하면 null. */
  duplicateActiveReservations: number | null;
}
export interface IndexRepairResult { ok: boolean; code: string }

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
export interface CoachPortalDiagnosisDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  models(): Promise<readonly string[]>;
  inspectCollection(options: MongoOperationOptions, model: string): Promise<{ exists: boolean; documents: number | null }>;
  checkCollection(options: MongoOperationOptions, model: string): Promise<void>;
  checks(): Promise<{ label: string; run(options: MongoOperationOptions): Promise<void> }[]>;
  countDuplicateActiveReservations(options: MongoOperationOptions): Promise<number>;
  createActiveReservationIndex(options: MongoOperationOptions): Promise<void>;
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
      { label: SCHEDULE_OPEN_LABEL, run: async options => { await schedule.MongoCoachScheduleRepository.open({ ...options, allowShadowWrites: true }); } },
      { label: "요청 감사 저장소 열기", run: async options => { await audit.MongoRequestAuditRepository.open({ ...options, allowShadowWrites: true }); } },
    ];
  },
  countDuplicateActiveReservations: async options => (await import("./mongoCoachScheduleRepository")).countDuplicateActiveReservations(options),
  createActiveReservationIndex: async options => (await import("./mongoCoachScheduleRepository")).createMongoActiveReservationIndex({ ...options, allowShadowWrites: true }),
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

type ShadowSession =
  | { ok: true; options: MongoOperationOptions }
  | { ok: false; label: string; code: string };

/** 설정 확인 → 연결까지 운영 runtime과 같은 순서로 밟고, 끝나면 client를 닫는다. */
async function withShadowSession<T>(
  environment: MongoCompositionEnvironment,
  dependencies: CoachPortalDiagnosisDependencies,
  work: (session: ShadowSession) => Promise<T>
): Promise<T> {
  let shadow: { databaseName: string; namespace: string };
  try { shadow = requireMongoShadowComposition(environment); }
  catch (error) { return work({ ok: false, label: "Mongo 설정(namespace·암호화 키·URI)", code: compositionFailureCode(error) }); }
  let client: Client | undefined;
  try {
    try { client = dependencies.createClient(environment); await client.connect(); }
    catch (error) { return await work({ ok: false, label: "Mongo 연결", code: mongoFailureCode(error) }); }
    return await work({ ok: true, options: { client: client as unknown as MongoClient, ...shadow } });
  } finally {
    if (client) try { await client.close(); } catch {}
  }
}

export async function diagnoseCoachPortal(
  environment: MongoCompositionEnvironment = process.env,
  dependencies: CoachPortalDiagnosisDependencies = defaults
): Promise<CoachPortalDiagnosis> {
  const result: CoachPortalDiagnosis = {
    selectors: COACH_BACKEND_SELECTORS.map(name => ({ name, value: selectorValue(environment[name]) })),
    steps: [],
    collections: [],
    duplicateActiveReservations: null,
  };
  const step = (label: string, ok: boolean, code = "OK") => { result.steps.push({ label, ok, code }); };

  const backend = environment.COACH_PORTAL_BACKEND?.trim() || "postgres";
  if (backend !== "mongodb-shadow") {
    step("포털 저장소 선택", backend === "postgres", backend === "postgres" ? "POSTGRES" : "UNKNOWN_BACKEND");
    return result;
  }

  return withShadowSession(environment, dependencies, async session => {
    if (!session.ok) {
      if (session.label === "Mongo 연결") step("Mongo 설정(namespace·암호화 키·URI)", true);
      step(session.label, false, session.code);
      return result;
    }
    step("Mongo 설정(namespace·암호화 키·URI)", true);
    step("Mongo 연결", true);
    const { options } = session;

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

    try { result.duplicateActiveReservations = await dependencies.countDuplicateActiveReservations(options); }
    catch { result.duplicateActiveReservations = null; }
    return result;
  });
}

/**
 * 활성 예약 인덱스(runtime_active_reservation) 1개만 만든다. 문서는 바꾸지 않는다.
 * 실행 직전에 중복을 다시 세고 0이 아니면 만들지 않는다. 만든 뒤에는 일정 저장소가 실제로 열리는지 확인한다.
 */
export async function repairActiveReservationIndex(
  environment: MongoCompositionEnvironment = process.env,
  dependencies: CoachPortalDiagnosisDependencies = defaults
): Promise<IndexRepairResult> {
  if ((environment.COACH_PORTAL_BACKEND?.trim() || "postgres") !== "mongodb-shadow") return { ok: false, code: "NOT_MONGODB_SHADOW" };
  return withShadowSession(environment, dependencies, async session => {
    if (!session.ok) return { ok: false, code: session.code };
    const { options } = session;
    let duplicates: number;
    try { duplicates = await dependencies.countDuplicateActiveReservations(options); }
    catch (error) { return { ok: false, code: mongoFailureCode(error) }; }
    if (duplicates !== 0) return { ok: false, code: "DUPLICATE_ACTIVE_RESERVATIONS" };
    try { await dependencies.createActiveReservationIndex(options); }
    catch (error) { return { ok: false, code: mongoFailureCode(error) }; }
    const scheduleOpen = (await dependencies.checks()).find(check => check.label === SCHEDULE_OPEN_LABEL);
    try { await scheduleOpen?.run(options); return { ok: true, code: "OK" }; }
    catch (error) { return { ok: false, code: mongoFailureCode(error) }; }
  });
}
