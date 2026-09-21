/** Offline JSON comparison only: no dotenv, DB client, network, subprocess or output files. */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { transitionManifest, assertTransitionBaseline, TransitionError, verifyOperationSlice } from "../src/lib/migration/operationTransition";

const usage = "Usage: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/check-mongodb-transition.ts --schema PATH --privacy-policy PATH --runtime-root PATH --source PATH --target PATH --sequence-high-water INTEGER";
function read(path: string) {
  const stats = statSync(path);
  if (!stats.isFile() || stats.size > 8 * 1024 * 1024) throw new TransitionError("INPUT_FILE_LIMIT");
  return readFileSync(path, "utf8");
}
try {
  const args = process.argv.slice(2);
  const required = ["--schema", "--privacy-policy", "--runtime-root", "--source", "--target", "--sequence-high-water"];
  if (args.length === 1 && args[0] === "--help") console.log(usage);
  else {
    const flags = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      if (!required.includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw new TransitionError("INVALID_ARGUMENTS");
      flags.set(args[i], args[i + 1]);
    }
    if (flags.size !== required.length || !/^\d+$/.test(flags.get("--sequence-high-water")!)) throw new TransitionError("INVALID_ARGUMENTS");
    const runtimeSources = Object.fromEntries(Object.keys(transitionManifest.runtimeContractSha256).map(path => [path, read(join(flags.get("--runtime-root")!, path))]));
    assertTransitionBaseline(read(flags.get("--schema")!), read(flags.get("--privacy-policy")!), runtimeSources);
    const result = verifyOperationSlice(JSON.parse(read(flags.get("--source")!)), JSON.parse(read(flags.get("--target")!)), Number(flags.get("--sequence-high-water")));
    console.log(JSON.stringify(result));
  }
} catch (error) {
  // JSON parse/fs errors may include payloads or private filenames; never print them.
  console.error(JSON.stringify({ equivalent: false, readyForCutover: false, code: error instanceof TransitionError ? error.code : "INPUT_READ_OR_JSON_ERROR" }));
  process.exitCode = 1;
}
