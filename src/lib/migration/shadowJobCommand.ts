import path from "node:path";

/** Closed command/environment boundary for a one-shot container. Never runs application startup. */
export function shadowJobCommand(args: string[], source: Record<string, string | undefined>) {
  const fail = (): never => { throw new Error("SHADOW_JOB_CONFIGURATION_INVALID"); };
  if (source.RUN_DB_MIGRATIONS && source.RUN_DB_MIGRATIONS !== "false") fail();
  const [mode, ...parameters] = args;
  const env: Record<string, string> & { NODE_ENV: "production" } = {
    NODE_ENV: "production", RUN_DB_MIGRATIONS: "false", PII_ALLOW_PLAINTEXT_READS: "false",
    PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp"
  };
  for (const key of ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY"]) {
    if (!source[key]) fail();
    env[key] = source[key]!;
  }
  let script: string;
  let childArgs: string[];
  if (mode === "export") {
    const [sourceMode, confirmation, ...extra] = parameters;
    if (!["plaintext", "encrypted"].includes(sourceMode) || confirmation !== "--allow-read-only-source-export" || extra.length || !source.DATABASE_URL) fail();
    env.DATABASE_URL = source.DATABASE_URL!;
    // Server startup defaults to read-only even before the export's explicit RO transaction.
    env.PGOPTIONS = "-c default_transaction_read_only=on -c statement_timeout=60000 -c idle_in_transaction_session_timeout=60000";
    script = "scripts/export-mongodb-shadow.ts";
    childArgs = [confirmation, "--output-parent", "/spool", "--source-mode", sourceMode];
  } else if (mode === "import") {
    const [directory, runId, confirmation, ...extra] = parameters;
    if (!directory || path.dirname(path.resolve(directory)) !== "/spool" || !/^mongo-shadow-[A-Za-z0-9_-]+$/.test(path.basename(directory)) || !/^[A-Za-z0-9_-]{1,80}$/.test(runId ?? "") || confirmation !== "--apply-shadow-only" || extra.length) fail();
    if (source.MONGODB_SHADOW_DATABASE !== "hub-om-shadow-validation" || !source.MONGODB_PRODUCTION_DATABASE || source.MONGODB_PRODUCTION_DATABASE.toLowerCase() === source.MONGODB_SHADOW_DATABASE.toLowerCase() || source.MONGODB_ALLOW_SHADOW_WRITES !== "true" || !source.MONGODB_URI) fail();
    for (const key of ["MONGODB_URI", "MONGODB_SHADOW_DATABASE", "MONGODB_PRODUCTION_DATABASE", "MONGODB_ALLOW_SHADOW_WRITES"]) env[key] = source[key]!;
    script = "scripts/import-mongodb-shadow.ts";
    childArgs = [path.resolve(directory), runId, confirmation];
  } else return fail();
  return { args: ["--experimental-strip-types", "--experimental-loader", "./scripts/ts-loader.mjs", script, ...childArgs], env };
}
