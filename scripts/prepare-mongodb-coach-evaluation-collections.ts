import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../src/lib/mongodb/connection";
import { requireMongoShadowComposition } from "../src/lib/data/mongoShadowComposition";
import { mongoFailureCode } from "../src/lib/data/mongoOperationPrimitives";
import {
  createMissingCoachEvaluationCollections,
  inspectCoachEvaluationCollections
} from "../src/lib/data/mongoCoachEvaluationCollections";

/**
 * 코치 평가·사실 기록 컬렉션 3개 준비. 절차: docs/operations/coach-evaluation-collections.md
 *   Run as: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/prepare-mongodb-coach-evaluation-collections.ts [args]
 *   Report (read-only): (no args)
 *   Create missing:     MONGODB_ALLOW_SHADOW_WRITES=true, --apply --confirm-target=<db>/<namespace> --backup-confirmed
 * 이미 있는 컬렉션은 바꾸지 않는다. 계약과 다른 컬렉션이 있으면 아무것도 만들지 않고 멈춘다.
 */
async function main() {
  const args = process.argv.slice(2);
  const { databaseName, namespace } = requireMongoShadowComposition(process.env);
  const target = `${databaseName}/${namespace}`;
  const apply = args.length === 3 && args[0] === "--apply" && args[1] === `--confirm-target=${target}` && args[2] === "--backup-confirmed";
  if (!(args.length === 0 || apply)) throw new Error("INVALID_ARGUMENTS");
  if (apply && process.env.MONGODB_ALLOW_SHADOW_WRITES !== "true") throw new Error("SHADOW_WRITE_GATE");

  const client = new MongoClient(configuredMongoUri(), mongoConnectionOptions());
  try {
    await client.connect();
    const options = { client, databaseName, namespace };
    if (apply) {
      const outcome = await createMissingCoachEvaluationCollections({ ...options, allowShadowWrites: true });
      console.log(JSON.stringify({ target, mode: "applied", ...outcome }, null, 2));
      return;
    }
    const collections = await inspectCoachEvaluationCollections(options);
    console.log(JSON.stringify({ target, mode: "report", collections }, null, 2));
    if (collections.some((status) => status.state === "different")) process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, code: mongoFailureCode(error) }));
  process.exitCode = 1;
});
