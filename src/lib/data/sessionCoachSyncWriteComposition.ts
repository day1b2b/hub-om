// ②/S1: 운영현황 입력에서 코치 engagement를 쓸 때의 백엔드 라우팅 래퍼.
// 운영현황 쓰기 흐름의 일부이므로 OPERATION_WRITE_BACKEND를 그대로 따른다(라이브=mongodb-shadow → 라이브 Mongo).
// operationWriteComposition과 같은 모양: postgres면 work() 직행, mongodb-shadow면 Mongo 런타임 스코프 안에서 실행.
// raw getPrismaClient(Postgres)로 새지 않게, Mongo 모드에선 반드시 이 래퍼로 감싼 뒤 getSessionCoachSyncRepository()를 쓴다.
import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoSessionCoachSyncRuntime } from "./mongoSessionCoachSyncRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface SessionCoachSyncWriteCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
}
const defaults: SessionCoachSyncWriteCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: input => openMongoSessionCoachSyncRuntime({ ...input, client: input.client as MongoClient })
};
function safeCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : "UNKNOWN";
}

export async function runSessionCoachSyncWriteRequest<T>(
  work: () => Promise<T>,
  environment: MongoCompositionEnvironment = process.env,
  dependencies: SessionCoachSyncWriteCompositionDependencies = defaults
): Promise<T> {
  const backend = environment.OPERATION_WRITE_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("SESSION_COACH_SYNC_WRITE_COMPOSITION_FAILED");
  let client: Client | undefined;
  let stage = "configuration";
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    stage = "connect";
    client = dependencies.createClient(environment);
    await client.connect();
    stage = "open";
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    stage = "work";
    return await runtime.run(work);
  } catch (error) {
    const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
    if (digest === "NEXT_HTTP_ERROR_FALLBACK;404" || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest))) throw error;
    console.error(`[session-coach-sync] SESSION_COACH_SYNC_WRITE_COMPOSITION_FAILED stage=${stage} cause=${safeCode(error)}`);
    throw new Error("SESSION_COACH_SYNC_WRITE_COMPOSITION_FAILED");
  } finally {
    if (client) try { await client.close(); } catch {}
  }
}
