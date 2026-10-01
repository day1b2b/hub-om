import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { readNotionDatabaseImport } from "./notionImport";
import type { NotionImportSource } from "./notionImportSource";
import { openMongoNotionImportRuntime } from "./mongoNotionImportRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface NotionImportCompositionDependencies {
  createClient(env: MongoCompositionEnvironment): Client;
  source: NotionImportSource;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; notionImportSource: NotionImportSource }): Promise<Runtime>;
}

const defaults: NotionImportCompositionDependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  source: Object.freeze({ readDatabase: readNotionDatabaseImport }),
  openRuntime: input => openMongoNotionImportRuntime({ ...input, client: input.client as MongoClient })
};

export async function runNotionImportRequest<T>(
  work: () => Promise<T>,
  env: MongoCompositionEnvironment = process.env,
  dependencies: NotionImportCompositionDependencies = defaults
): Promise<T> {
  const backend = env.NOTION_IMPORT_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("NOTION_IMPORT_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(env);
    client = dependencies.createClient(env);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, notionImportSource: dependencies.source });
    return await runtime.run(work);
  } catch { throw new Error("NOTION_IMPORT_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch { /* Preserve an already audited result. */ } }
}
