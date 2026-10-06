import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import {
  requireMongoShadowComposition,
  type MongoCompositionEnvironment
} from "./mongoShadowComposition";

interface Client {
  connect(): Promise<unknown>;
  close(): Promise<void>;
}

interface Runtime {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface AnnouncementCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: {
    client: Client;
    databaseName: string;
    namespace: string;
    allowShadowWrites: true;
  }): Promise<Runtime>;
}

const defaults: AnnouncementCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: async input => {
    const { openMongoAnnouncementRuntime } = await import("./mongoAnnouncementRuntime");
    return openMongoAnnouncementRuntime({ ...input, client: input.client as MongoClient });
  }
};

export async function runAnnouncementRequest<T>(
  work: () => Promise<T>,
  environment: MongoCompositionEnvironment = process.env,
  dependencies: AnnouncementCompositionDependencies = defaults
): Promise<T> {
  const backend = environment.ANNOUNCEMENT_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("ANNOUNCEMENT_COMPOSITION_FAILED");

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
    const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
    if (digest === "NEXT_HTTP_ERROR_FALLBACK;404") throw error;
    throw new Error("ANNOUNCEMENT_COMPOSITION_FAILED");
  } finally {
    if (client) try { await client.close(); } catch {}
  }
}
