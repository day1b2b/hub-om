import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../src/lib/mongodb/connection";
import { requireMongoShadowComposition } from "../src/lib/data/mongoShadowComposition";
import { mongoFailureCode } from "../src/lib/data/mongoOperationPrimitives";
import { applyEnumWidening, inspectOperationValidators, parseEnumWidening, restoreDeployedValidator } from "../src/lib/data/mongoValidatorWidening";
import { applyFieldAddition, emitFieldAdditionTarget, inspectFieldAddition, parseFieldAdditionTarget, restoreFieldAddition, storedValidatorIsFieldAddition } from "../src/lib/data/mongoValidatorFieldAddition";

/**
 * Operation collection validators vs the contract. Procedure: docs/operations/mongodb-operation-validator-change.md
 *   Run as: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/apply-mongodb-operation-validator.ts [args]
 *   Report (read-only):  (no args)
 *   Enum widening
 *     Plan (read-only):  --widen=OperationSession.educationFormat=OFFLINE,REMOTE,ONLINE,...
 *     Apply:             MONGODB_ALLOW_SHADOW_WRITES=true, --widen=... --apply --confirm-target=<db>/<namespace> --backup-confirmed
 *   Nullable field addition
 *     Token (no DB, from the build with the next contract): --emit-field-addition=Company
 *     Plan (read-only):  --add-fields=<token>
 *     Apply:             MONGODB_ALLOW_SHADOW_WRITES=true, --add-fields=<token> --apply --confirm-target=<db>/<namespace> --backup-confirmed
 *   Roll back a widening or a field addition (from the build whose deploy you are returning to):
 *                      MONGODB_ALLOW_SHADOW_WRITES=true, --restore=OperationSession --apply --confirm-target=<db>/<namespace> --backup-confirmed
 */
async function main() {
  const args = process.argv.slice(2);
  const emitModel = args.length === 1 && args[0].startsWith("--emit-field-addition=") ? args[0].slice("--emit-field-addition=".length) : undefined;
  if (emitModel !== undefined) {
    console.log(JSON.stringify(emitFieldAdditionTarget(emitModel), null, 2));
    return;
  }
  const { databaseName, namespace } = requireMongoShadowComposition(process.env);
  const widenArgument = args[0]?.startsWith("--widen=") ? args[0].slice("--widen=".length) : undefined;
  const additionArgument = args[0]?.startsWith("--add-fields=") ? args[0].slice("--add-fields=".length) : undefined;
  const restoreModel = args[0]?.startsWith("--restore=") ? args[0].slice("--restore=".length) : undefined;
  const apply = args.length === 4 && !!(widenArgument || additionArgument || restoreModel) && args[1] === "--apply" && args[2] === `--confirm-target=${databaseName}/${namespace}` && args[3] === "--backup-confirmed";
  if (!(args.length === 0 || (args.length === 1 && (widenArgument || additionArgument)) || apply)) throw new Error("INVALID_VALIDATOR_ARGUMENTS");
  if (apply && process.env.MONGODB_ALLOW_SHADOW_WRITES !== "true") throw new Error("SHADOW_WRITE_GATE");
  const widening = widenArgument ? parseEnumWidening(widenArgument) : undefined;
  const addition = additionArgument ? parseFieldAdditionTarget(additionArgument) : undefined;
  const client = new MongoClient(configuredMongoUri(), mongoConnectionOptions());
  try {
    await client.connect();
    const options = { client, databaseName, namespace };
    const target = `${databaseName}/${namespace}`;
    if (apply && restoreModel) {
      if (await storedValidatorIsFieldAddition(options, restoreModel)) {
        const outcome = await restoreFieldAddition({ ...options, allowShadowWrites: true }, restoreModel);
        console.log(JSON.stringify({ target, mode: outcome.outcome, model: restoreModel, fields: outcome.fields, cleared: outcome.cleared }, null, 2));
        return;
      }
      const outcome = await restoreDeployedValidator({ ...options, allowShadowWrites: true }, restoreModel);
      console.log(JSON.stringify({ target, mode: outcome, model: restoreModel }, null, 2));
      return;
    }
    if (apply && addition) {
      const outcome = await applyFieldAddition({ ...options, allowShadowWrites: true }, addition);
      console.log(JSON.stringify({ target, mode: outcome.outcome, model: addition.model, digest: addition.digest, filled: outcome.filled, indexesCreated: outcome.indexesCreated,
        next: "Deploy the matching contract now; the running build fails readiness until it does." }, null, 2));
      return;
    }
    if (addition) {
      console.log(JSON.stringify({ target, mode: "plan", ...await inspectFieldAddition(options, addition) }, null, 2));
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
