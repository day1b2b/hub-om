import fs from "node:fs";
import { pathToFileURL } from "node:url";

function loadEnv(path) {
  if (!fs.existsSync(path)) return;

  for (const rawLine of fs.readFileSync(path, "utf8").split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n");
    }
    process.env[match[1]] = value;
  }
}

async function main() {
  loadEnv(".env");
  loadEnv(".env.local");

  // Defer application imports too: importing this CLI never loads env or opens storage.
  const { parseDriveImportArgs, runDriveImportDryRun } = await import("../src/lib/driveImports/driveImportDryRun.ts");
  const { getDriveImportWriterRepository } = await import("../src/lib/data/driveImportWriterFactory.ts");
  const args = parseDriveImportArgs(process.argv.slice(2), process.env.DRIVE_IMPORT_DRY_RUN_CONCURRENCY);
  const result = await runDriveImportDryRun(args, message => console.log(message));
  await getDriveImportWriterRepository().close();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("DRIVE_IMPORT_WRITER_FAILED");
    process.exit(1);
  });
}
