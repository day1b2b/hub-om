import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import {
  requireMongoShadowComposition,
  type MongoCompositionEnvironment
} from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }

export interface AdminBackupCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: {
    client: Client;
    databaseName: string;
    namespace: string;
    allowShadowWrites: true;
  }): Promise<Runtime>;
}

const defaults: AdminBackupCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: async input => {
    const { openMongoAdminBackupRuntime } = await import("./mongoAdminBackupRuntime");
    return openMongoAdminBackupRuntime({ ...input, client: input.client as MongoClient });
  }
};

export async function runAdminBackupRequest<T>(
  work: () => Promise<T>,
  environment: MongoCompositionEnvironment = process.env,
  dependencies: AdminBackupCompositionDependencies = defaults
): Promise<T> {
  const backend = environment.ADMIN_BACKUP_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("ADMIN_BACKUP_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    return await runtime.run(work);
  } catch {
    throw new Error("ADMIN_BACKUP_COMPOSITION_FAILED");
  } finally {
    if (client) try { await client.close(); } catch {}
  }
}
