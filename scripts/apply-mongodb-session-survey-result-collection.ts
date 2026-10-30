import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../src/lib/mongodb/connection";
import { requireMongoShadowComposition } from "../src/lib/data/mongoShadowComposition";
import { mongoFailureCode } from "../src/lib/data/mongoOperationPrimitives";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "../src/lib/data/mongoReadStore";
import { MongoOperationStore } from "../src/lib/data/mongoOperationStore";

const MODEL = "SessionSurveyResult";

/**
 * SessionSurveyResult 컬렉션 생성/점검 전용. OperationSession을 포함한 다른 컬렉션은 건드리지 않는다.
 * 운영 중단 없이 반영하려면 배포 전에 --apply로 이 컬렉션부터 만들어 둬야 한다 — 새 코드가
 * 배포된 뒤에야 컬렉션을 만들면 그 사이 SessionSurveyResult를 읽는 경로(만족도 회차 반영, 강사 위키)가
 * 전부 저장소 준비 실패로 막힌다. 절차: docs/operations/mongodb-session-survey-result-collection.md
 *   Run as: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/apply-mongodb-session-survey-result-collection.ts [args]
 *   점검(읽기 전용, 기본값):  (인자 없음)
 *   생성:                MONGODB_ALLOW_SHADOW_WRITES=true, --apply --confirm-target=<db>/<namespace> --backup-confirmed
 */
async function main() {
  const args = process.argv.slice(2);
  const { databaseName, namespace } = requireMongoShadowComposition(process.env);
  const apply = args.length === 3 && args[0] === "--apply" && args[1] === `--confirm-target=${databaseName}/${namespace}` && args[2] === "--backup-confirmed";
  if (!(args.length === 0 || apply)) throw new Error("INVALID_ARGUMENTS");
  if (apply && process.env.MONGODB_ALLOW_SHADOW_WRITES !== "true") throw new Error("SHADOW_WRITE_GATE");
  const client = new MongoClient(configuredMongoUri(), mongoConnectionOptions());
  try {
    await client.connect();
    const options = { client, databaseName, namespace };
    const target = `${databaseName}/${namespace}`;
    if (apply) {
      await prepareMongoReadStore({ ...options, allowShadowWrites: true }, [MODEL]);
      console.log(JSON.stringify({ target, mode: "applied", model: MODEL, next: "Deploy the matching build now; SessionSurveyResult reads require this collection to already exist." }, null, 2));
      return;
    }
    const store = new MongoOperationStore(options, [MODEL]);
    try {
      await assertMongoReadStoreReady(store);
      console.log(JSON.stringify({ target, mode: "report", model: MODEL, ready: true }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ target, mode: "report", model: MODEL, ready: false, code: mongoFailureCode(error) }, null, 2));
      process.exitCode = 2;
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, code: mongoFailureCode(error) }));
  process.exitCode = 1;
});
