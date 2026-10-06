import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoImportTemplateRuntime, openMongoImportUploadRuntime } from "./mongoImportStagingRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

export type ImportStagingAction = "template" | "upload";
interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface ImportStagingCompositionDependencies {
  createClient(env: MongoCompositionEnvironment): Client;
  openTemplateRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
  openUploadRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
}
const defaults: ImportStagingCompositionDependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  openTemplateRuntime: input => openMongoImportTemplateRuntime({ ...input, client: input.client as MongoClient }),
  openUploadRuntime: input => openMongoImportUploadRuntime({ ...input, client: input.client as MongoClient })
};

export async function runImportStagingRequest<T>(action: ImportStagingAction, work: () => Promise<T>, env: MongoCompositionEnvironment = process.env, dependencies = defaults): Promise<T> {
  const backend = env.IMPORT_STAGING_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("IMPORT_STAGING_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(env);
    client = dependencies.createClient(env); await client.connect();
    const input = { client, databaseName, namespace, allowShadowWrites: true as const };
    const runtime = action === "template" ? await dependencies.openTemplateRuntime(input) : await dependencies.openUploadRuntime(input);
    return await runtime.run(work);
  } catch { throw new Error("IMPORT_STAGING_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch { /* Preserve completed response. */ } }
}
