import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../src/lib/mongodb/connection";
import { requireMongoShadowComposition } from "../src/lib/data/mongoShadowComposition";
import { mongoFailureCode } from "../src/lib/data/mongoOperationPrimitives";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "../src/lib/data/mongoReadStore";
import { MongoOperationStore } from "../src/lib/data/mongoOperationStore";

const MODEL = "SessionSurveyResult";

/**
 * SessionSurveyResult 컬렉션 생성/점검 전용. OperationSession을 포함한 다른 컬렉션은 건드리지 않는다.
 * 새 버전을 평소처럼 배포한 뒤 그 컨테이너에서 --apply로 만든다. 컬렉션이 없는 동안에도 운영 화면과
 * [hub-om 반영]은 막히지 않고(대체 저장소), 결과 기록만 "저장하지 못함"으로 알린다.
 * 절차: docs/operations/mongodb-session-survey-result-collection.md
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
      console.log(JSON.stringify({ target, mode: "applied", model: MODEL, next: "Collection ready; the running build starts recording on the next request (no redeploy needed)." }, null, 2));
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
