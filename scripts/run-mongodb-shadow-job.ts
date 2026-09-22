import { spawn } from "node:child_process";
import { shadowJobCommand } from "../src/lib/migration/shadowJobCommand";
import { assertPrivacyConfiguration } from "../src/lib/privacy/crypto";

try {
  const command = shadowJobCommand(process.argv.slice(2), process.env);
  assertPrivacyConfiguration();
  // No shell, inherited NODE_OPTIONS, application entrypoint, migration, or automatic .env loading.
  const child = spawn(process.execPath, command.args, { cwd: "/app", env: command.env, stdio: "inherit" });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { child.kill(signal); });
  child.once("error", () => { console.error("SHADOW_JOB_START_FAILED"); process.exitCode = 1; });
  child.once("exit", code => { process.exitCode = code ?? 1; });
} catch {
  console.error("SHADOW_JOB_CONFIGURATION_INVALID");
  process.exitCode = 1;
}
