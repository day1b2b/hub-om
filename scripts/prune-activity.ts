import { config } from "dotenv";
import { pathToFileURL } from "node:url";
import { runActivityPruneCommand } from "../src/lib/data/activityPruneCommand";

async function main(): Promise<void> {
  await runActivityPruneCommand(() => {
    config({ path: ".env.local" });
    config({ path: ".env" });
  }, (summary) => console.log(JSON.stringify(summary)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("ACTIVITY_PRUNE_FAILED");
    process.exitCode = 1;
  });
}
