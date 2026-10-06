import { config } from "dotenv";
import pg from "pg";
import { pathToFileURL } from "node:url";
import { inspectPostgresRuntimeContract, type PostgresRuntimeClient } from "../src/lib/migration/postgresRuntimeContract";

function safeConnectionString(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error();
    if ([...url.searchParams.keys()].some(key => key.toLowerCase() === "options")) throw new Error();
    return value;
  } catch {
    throw new Error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");
  }
}

export async function runPostgresRuntimeContractCommand(
  suppliedEnvironment?: NodeJS.ProcessEnv,
  write: (value: string) => void = console.log,
): Promise<number> {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  const environment = suppliedEnvironment ?? process.env;
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) throw new Error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");

  const rawClient = new pg.Client({
    connectionString: safeConnectionString(connectionString),
    connectionTimeoutMillis: 5000,
    query_timeout: 7000,
    // The application forces UTC. default_transaction_read_only protects the
    // connection before the explicit read-only transaction starts.
    options: "-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=7000",
    application_name: "hub-om-runtime-contract-check",
  });
  const client: PostgresRuntimeClient = {
    connect: () => rawClient.connect(),
    query: (text, values) => rawClient.query(text, values),
    end: () => rawClient.end(),
    destroy: () => {
      const stream = rawClient.connection.stream;
      if (stream.closed) return Promise.resolve();
      return new Promise<void>(resolve => {
        stream.once("close", resolve);
        if (!stream.destroyed) stream.destroy();
      });
    },
    on: (event, listener) => rawClient.on(event, listener),
    off: (event, listener) => rawClient.off(event, listener),
  };
  const report = await inspectPostgresRuntimeContract(client);
  write(JSON.stringify(report));
  return report.status === "compatible" ? 0 : 2;
}

async function main(): Promise<void> {
  process.exitCode = await runPostgresRuntimeContractCommand();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");
    process.exitCode = 1;
  });
}
