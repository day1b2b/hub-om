import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import {
  requireMongoShadowComposition,
  type MongoCompositionEnvironment
} from "./mongoShadowComposition";
import { openMongoDriveImportPageRuntime } from "./mongoDriveImportPageRuntime";

interface Client {
  connect(): Promise<unknown>;
  close(): Promise<void>;
}

interface Runtime {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface DriveImportPageCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: {
    client: Client;
    databaseName: string;
    namespace: string;
    allowShadowWrites: true;
  }): Promise<Runtime>;
}

const defaults: DriveImportPageCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: input => openMongoDriveImportPageRuntime({ ...input, client: input.client as MongoClient })
};

function isNextNavigation(error: unknown): boolean {
  const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest);
}

export async function runDriveImportPageRequest<T>(
  work: () => Promise<T>,
  environment: MongoCompositionEnvironment = process.env,
  dependencies: DriveImportPageCompositionDependencies = defaults
): Promise<T> {
  const backend = environment.DRIVE_IMPORT_PAGE_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("DRIVE_IMPORT_PAGE_COMPOSITION_FAILED");

  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = await dependencies.openRuntime({
      client,
      databaseName,
      namespace,
      allowShadowWrites: true
    });
    return await runtime.run(work);
  } catch (error) {
    if (isNextNavigation(error)) throw error;
    throw new Error("DRIVE_IMPORT_PAGE_COMPOSITION_FAILED");
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {}
    }
  }
}
