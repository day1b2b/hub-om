import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoCompanyBusinessInfoRuntime } from "./mongoCompanyBusinessInfoRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface CompanyBusinessInfoCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
}

const defaults: CompanyBusinessInfoCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: input => openMongoCompanyBusinessInfoRuntime({ ...input, client: input.client as MongoClient })
};

function isNextControlFlow(error: unknown): boolean {
  const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
  return digest === "NEXT_HTTP_ERROR_FALLBACK;404"
    || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest));
}

/**
 * 사업자등록증 정보는 기업위키 화면(Company)과 같은 데이터이므로, 그 화면을 여는
 * overviewPagesComposition과 같은 플래그(OVERVIEW_PAGES_BACKEND)로 백엔드를 고른다 —
 * 별도 플래그를 두면 화면은 Mongo, 저장은 Postgres로 어긋날 수 있다.
 */
export async function runCompanyBusinessInfoRequest<T>(
  work: () => Promise<T>,
  environment: MongoCompositionEnvironment = process.env,
  dependencies: CompanyBusinessInfoCompositionDependencies = defaults
): Promise<T> {
  const backend = environment.OVERVIEW_PAGES_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("COMPANY_BUSINESS_INFO_COMPOSITION_FAILED");

  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    return await runtime.run(work);
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    throw new Error("COMPANY_BUSINESS_INFO_COMPOSITION_FAILED");
  } finally {
    if (client) try { await client.close(); } catch {}
  }
}
