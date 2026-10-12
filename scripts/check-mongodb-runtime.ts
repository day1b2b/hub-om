import { openMongoCoachAdminRuntime } from "../src/lib/data/mongoCoachAdminRuntime";
import { openMongoCoachManagementRuntime } from "../src/lib/data/mongoCoachManagementRuntime";
import { openMongoChangesRuntime } from "../src/lib/data/mongoChangesRuntime";
import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../src/lib/mongodb/connection";
import { requireMongoShadowComposition } from "../src/lib/data/mongoShadowComposition";
import { recoverMongoCoachCatalog, recoverMongoInternalStructures } from "../src/lib/data/mongoCoachCatalogRecovery";
import { openMongoLectureFollowUpRuntime } from "../src/lib/data/mongoLectureFollowUpRuntime";
import { openMongoCalendarRuntime } from "../src/lib/data/mongoCalendarRuntime";

async function main() {
  const args = process.argv.slice(2);
  const { databaseName, namespace } = requireMongoShadowComposition(process.env);
  const apply = args.length === 3 && args[0] === "--prepare-missing-internal-structures" && args[1] === `--confirm-target=${databaseName}/${namespace}` && args[2] === "--backup-confirmed";
  if (args.length && !apply) throw new Error("INVALID_RECOVERY_ARGUMENTS");
  if (apply && process.env.MONGODB_ALLOW_SHADOW_WRITES !== "true") throw new Error("SHADOW_WRITE_GATE");
  const client = new MongoClient(configuredMongoUri(), mongoConnectionOptions());
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    // Calendar readiness is read-only, and must pass before a repair is attempted.
    await openMongoCalendarRuntime(options);
    const result = await recoverMongoCoachCatalog(options, apply);
    if (result.ready) {
      await openMongoCoachAdminRuntime(options);
      await openMongoCoachManagementRuntime(options);
      await openMongoChangesRuntime(options);
    }
    const internal = await recoverMongoInternalStructures(options, apply);
    const internalReady = internal.every(item => item.ready);
    if (internalReady) await openMongoLectureFollowUpRuntime({ ...options, lectureFollowUpNotifier: { async send() { throw new Error("CHECK_ONLY"); } } });
    console.log(JSON.stringify({ ...result, calendarReady: true, coachRuntimesReady: result.ready, internal, lectureFollowUpReady: internalReady }));
    if (!result.ready || !internalReady) process.exitCode = 1;
  } finally { await client.close(); }
}
main().catch(() => {
  console.error(JSON.stringify({ ready: false, code: "MONGODB_RUNTIME_NOT_READY" }));
  process.exitCode = 1;
});
