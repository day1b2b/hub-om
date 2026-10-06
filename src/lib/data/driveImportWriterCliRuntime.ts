import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { parseDriveImportArgs, runDriveImportDryRun } from "../driveImports/driveImportDryRun";
import { getDriveImportSource, type DriveImportSource } from "./driveImportSource";
import { getDriveImportWriterRepository } from "./driveImportWriterFactory";
import { openMongoDriveImportWriterRuntime } from "./mongoDriveImportWriterRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }
export interface DriveImportWriterCliDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  source: DriveImportSource;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; driveImportSource: DriveImportSource }): Promise<Runtime>;
  parseArgs: typeof parseDriveImportArgs;
  runWorkflow: typeof runDriveImportDryRun;
  getDefaultWriter: typeof getDriveImportWriterRepository;
}
const defaults: DriveImportWriterCliDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  get source() { return getDriveImportSource(); },
  openRuntime: input => openMongoDriveImportWriterRuntime({ ...input, client: input.client as MongoClient }),
  parseArgs: parseDriveImportArgs,
  runWorkflow: runDriveImportDryRun,
  getDefaultWriter: getDriveImportWriterRepository,
};

/** PostgreSQL remains default. Mongo requires one exact selector and a prepared shadow namespace. */
export async function runDriveImportWriterCli(
  argv: string[], environment: MongoCompositionEnvironment, loadDefaultEnvironment: () => void,
  progress: (message: string) => void = () => {}, dependencies: DriveImportWriterCliDependencies = defaults,
) {
  const selectors = argv.filter(value => value.startsWith("--backend="));
  if (!selectors.length) {
    loadDefaultEnvironment();
    const args = dependencies.parseArgs(argv, environment.DRIVE_IMPORT_DRY_RUN_CONCURRENCY);
    const result = await dependencies.runWorkflow(args, progress);
    await dependencies.getDefaultWriter().close();
    return result;
  }
  if (selectors.length !== 1 || selectors[0] !== "--backend=mongodb-shadow") throw new Error("DRIVE_IMPORT_WRITER_FAILED");
  const commandArgs = argv.filter(value => !value.startsWith("--backend="));
  const args = dependencies.parseArgs(commandArgs, environment.DRIVE_IMPORT_DRY_RUN_CONCURRENCY);
  let client: Client | undefined;
  let result: Awaited<ReturnType<typeof runDriveImportDryRun>> | undefined;
  let failed = false;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, driveImportSource: dependencies.source });
    result = await runtime.run(() => dependencies.runWorkflow(args, progress));
  } catch { failed = true; }
  finally { if (client) try { await client.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("DRIVE_IMPORT_WRITER_FAILED");
  return result;
}
