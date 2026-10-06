import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { listGoogleSheetTabs, readGoogleSheetRows } from "./googleSheetsImport";
import type { GoogleSheetsImportSource } from "./googleSheetsImportSource";
import { openMongoGoogleSheetsImportRuntime, openMongoGoogleSheetsTabsRuntime } from "./mongoGoogleSheetsImportRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

export type GoogleSheetsImportAction = "tabs" | "import";
interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface GoogleSheetsImportCompositionDependencies {
  createClient(env: MongoCompositionEnvironment): Client;
  source: GoogleSheetsImportSource;
  openTabsRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; googleSheetsImportSource: GoogleSheetsImportSource }): Promise<Runtime>;
  openImportRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; googleSheetsImportSource: GoogleSheetsImportSource }): Promise<Runtime>;
}

const defaults: GoogleSheetsImportCompositionDependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  source: Object.freeze({ listTabs: listGoogleSheetTabs, readRows: readGoogleSheetRows }),
  openTabsRuntime: input => openMongoGoogleSheetsTabsRuntime({ ...input, client: input.client as MongoClient }),
  openImportRuntime: input => openMongoGoogleSheetsImportRuntime({ ...input, client: input.client as MongoClient })
};

export async function runGoogleSheetsImportRequest<T>(action: GoogleSheetsImportAction, work: () => Promise<T>, env: MongoCompositionEnvironment = process.env, dependencies = defaults): Promise<T> {
  const backend = env.GOOGLE_SHEETS_IMPORT_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("GOOGLE_SHEETS_IMPORT_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(env);
    client = dependencies.createClient(env); await client.connect();
    const input = { client, databaseName, namespace, allowShadowWrites: true as const, googleSheetsImportSource: dependencies.source };
    const runtime = action === "tabs" ? await dependencies.openTabsRuntime(input) : await dependencies.openImportRuntime(input);
    return await runtime.run(work);
  } catch { throw new Error("GOOGLE_SHEETS_IMPORT_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch { /* Preserve an already audited response. */ } }
}
