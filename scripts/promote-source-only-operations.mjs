import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(process.execPath, [
  "--experimental-strip-types",
  "--experimental-loader", fileURLToPath(new URL("./ts-loader.mjs", import.meta.url)),
  fileURLToPath(new URL("./promote-source-only-operations.ts", import.meta.url)),
  ...process.argv.slice(2)
], { stdio: "inherit", env: process.env });

if (result.error) console.error("[source-only-promotion] 실행기를 시작하지 못했습니다.");
process.exitCode = result.status ?? 1;
