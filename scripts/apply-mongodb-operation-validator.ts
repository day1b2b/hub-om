import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../src/lib/mongodb/connection";
import { requireMongoShadowComposition } from "../src/lib/data/mongoShadowComposition";
import { mongoFailureCode } from "../src/lib/data/mongoOperationPrimitives";
import { applyEnumWidening, inspectOperationValidators, parseEnumWidening, restoreDeployedValidator } from "../src/lib/data/mongoValidatorWidening";

/**
 * Operation collection validators vs the contract. Procedure: docs/operations/mongodb-operation-validator-change.md
 *   Run as: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/apply-mongodb-operation-validator.ts [args]
 *   Report (read-only):  (no args)
 *   Plan (read-only):    --widen=OperationSession.educationFormat=OFFLINE,REMOTE,ONLINE,...
 *   Apply:               MONGODB_ALLOW_SHADOW_WRITES=true, --widen=... --apply --confirm-target=<db>/<namespace> --backup-confirmed
 *   Roll back a widening (from the build whose deploy you are returning to):
 *                        MONGODB_ALLOW_SHADOW_WRITES=true, --restore=OperationSession --apply --confirm-target=<db>/<namespace> --backup-confirmed
 */
async function main() {
  const args = process.argv.slice(2);
  const { databaseName, namespace } = requireMongoShadowComposition(process.env);
  const widenArgument = args[0]?.startsWith("--widen=") ? args[0].slice("--widen=".length) : undefined;
  const restoreModel = args[0]?.startsWith("--restore=") ? args[0].slice("--restore=".length) : undefined;
  const apply = args.length === 4 && !!(widenArgument || restoreModel) && args[1] === "--apply" && args[2] === `--confirm-target=${databaseName}/${namespace}` && args[3] === "--backup-confirmed";
  if (!(args.length === 0 || (args.length === 1 && widenArgument) || apply)) throw new Error("INVALID_VALIDATOR_ARGUMENTS");
  if (apply && process.env.MONGODB_ALLOW_SHADOW_WRITES !== "true") throw new Error("SHADOW_WRITE_GATE");
  const widening = widenArgument ? parseEnumWidening(widenArgument) : undefined;
  const client = new MongoClient(configuredMongoUri(), mongoConnectionOptions());
  try {
    await client.connect();
    const options = { client, databaseName, namespace };
    const target = `${databaseName}/${namespace}`;
    if (apply && restoreModel) {
      const outcome = await restoreDeployedValidator({ ...options, allowShadowWrites: true }, restoreModel);
      console.log(JSON.stringify({ target, mode: outcome, model: restoreModel }, null, 2));
      return;
    }
    if (apply) {
      const outcome = await applyEnumWidening({ ...options, allowShadowWrites: true }, widening!);
      console.log(JSON.stringify({ target, mode: outcome, widening, next: "Deploy the matching contract now; the running build fails readiness until it does." }, null, 2));
      return;
    }
    const statuses = await inspectOperationValidators(options, widening);
    console.log(JSON.stringify({
      target,
      mode: widening ? "plan" : "report",
      widening,
      collections: statuses.map(({ model, comparison, nonconformingSample }) => ({ model, ...comparison, nonconformingSample })),
    }, null, 2));
    if (!widening && statuses.some(status => status.comparison.kind !== "same")) process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, code: mongoFailureCode(error) }));
  process.exitCode = 1;
});
