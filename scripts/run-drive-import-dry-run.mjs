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
  const argv = process.argv.slice(2);
  let defaultEnvironmentLoaded = false;
  const loadDefaultEnvironment = () => {
    if (defaultEnvironmentLoaded) return;
    loadEnv(".env");
    loadEnv(".env.local");
    defaultEnvironmentLoaded = true;
  };
  if (!argv.some(value => value.startsWith("--backend="))) loadDefaultEnvironment();

  // Defer application imports too: importing this CLI never loads env or opens storage.
  const { runDriveImportWriterCli } = await import("../src/lib/data/driveImportWriterCliRuntime.ts");
  const result = await runDriveImportWriterCli(argv, process.env, loadDefaultEnvironment, message => console.log(message));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("DRIVE_IMPORT_WRITER_FAILED");
    process.exit(1);
  });
}
