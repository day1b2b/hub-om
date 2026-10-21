import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { getOmCustomToolsRepository } from "./omRequest/omCustomToolsLocalRepository";
import type { OmCustomToolsRepository } from "./omRequest/omRequestRepository";
import { openMongoOperationPagesRuntime } from "./mongoOperationPagesRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface OperationPagesCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  getCustomTools(): OmCustomToolsRepository;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; omCustomTools: OmCustomToolsRepository }): Promise<Runtime>;
}
const defaults: OperationPagesCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  getCustomTools: getOmCustomToolsRepository,
  openRuntime: input => openMongoOperationPagesRuntime({ ...input, client: input.client as MongoClient })
};
export function allowsLegacyOperationPageFallback(environment: MongoCompositionEnvironment = process.env): boolean {
  return (environment.OPERATION_PAGES_BACKEND?.trim() || "postgres") === "postgres";
}
function isNextControlFlow(error: unknown) {
  const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
  return digest === "NEXT_HTTP_ERROR_FALLBACK;404" || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest));
}
function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_:\- ]{1,160}$/.test(message) ? message : "REDACTED";
}
/**
 * 운영 페이지는 요청마다 열고 닫던 클라이언트(SRV 조회·TLS·인증)와 저장소 준비 확인(컬렉션·인덱스
 * 수십 회 왕복)이 목록 조회보다 오래 걸렸다. 프로세스당 연결 하나를 재사용하고, 준비 확인은
 * 처음 열 때와 TTL이 지난 뒤에만 다시 한다. 연결·준비 실패 시에는 버리고 다음 요청에서 새로 연다.
 */
export const OPERATION_PAGES_RUNTIME_TTL_MS = 5 * 60_000;
interface SharedRuntime { key: string; client: Client; runtime: Promise<Runtime>; expiresAt: number }
const globalForOperationPages = globalThis as typeof globalThis & { hubOmOperationPagesRuntime?: SharedRuntime };
export async function resetOperationPagesRuntime(): Promise<void> {
  const shared = globalForOperationPages.hubOmOperationPagesRuntime;
  globalForOperationPages.hubOmOperationPagesRuntime = undefined;
  if (shared) try { await shared.client.close(); } catch {}
}
function evict(shared: SharedRuntime) {
  if (globalForOperationPages.hubOmOperationPagesRuntime !== shared) return;
  globalForOperationPages.hubOmOperationPagesRuntime = undefined;
  void shared.client.close().catch(() => {});
}
function acquireRuntime(environment: MongoCompositionEnvironment, dependencies: OperationPagesCompositionDependencies, now: number): SharedRuntime {
  const { databaseName, namespace } = requireMongoShadowComposition(environment);
  const key = JSON.stringify([environment.MONGODB_URI?.trim(), databaseName, namespace]);
  let shared = globalForOperationPages.hubOmOperationPagesRuntime;
  if (shared && shared.key !== key) { evict(shared); shared = undefined; }
  if (shared && shared.expiresAt > now) return shared;
  const client = shared?.client ?? dependencies.createClient(environment);
  const connected = shared ? Promise.resolve() : client.connect();
  const next: SharedRuntime = { key, client, expiresAt: now + OPERATION_PAGES_RUNTIME_TTL_MS, runtime: connected.then(() =>
    dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, omCustomTools: dependencies.getCustomTools() })) };
  next.runtime.catch(() => evict(next));
  globalForOperationPages.hubOmOperationPagesRuntime = next;
  return next;
}
export async function runOperationPagesRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: OperationPagesCompositionDependencies = defaults, now = Date.now()): Promise<T> {
  const backend = environment.OPERATION_PAGES_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("OPERATION_PAGES_COMPOSITION_FAILED");
  try {
    const runtime = await acquireRuntime(environment, dependencies, now).runtime;
    return await runtime.run(work);
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    console.error("OPERATION_PAGES_COMPOSITION_FAILED", safeFailureCode(error));
    throw new Error("OPERATION_PAGES_COMPOSITION_FAILED");
  }
}
