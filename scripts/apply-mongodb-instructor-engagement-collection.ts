import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../src/lib/mongodb/connection";
import { requireMongoShadowComposition } from "../src/lib/data/mongoShadowComposition";
import { mongoFailureCode } from "../src/lib/data/mongoOperationPrimitives";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "../src/lib/data/mongoReadStore";
import { MongoOperationStore } from "../src/lib/data/mongoOperationStore";
import { assertMongoInstructorCatalogGuardReady, prepareMongoInstructorCatalogGuard } from "../src/lib/data/mongoInstructorCatalogGuard";

/**
 * InstructorEngagement / InstructorEngagementSchedule 컬렉션 + 강사 카탈로그 가드 생성/점검 전용.
 * (apply-mongodb-session-survey-result-collection 패턴) 기존 공유 컬렉션(Course·OperationSession·InstructorNote·ActivityChange)은 건드리지 않는다.
 *
 * 신규 컬렉션이라 OPERATION_MODELS에 없어 운영현황·대시보드 스토어 준비검사 대상이 아니다 → 배포가 기존 화면을 깨지 않는다.
 * 컬렉션이 없는 동안 강사 입력(/api/operations/[id]/instructors)·백필만 열기 실패(500)하고, 다른 화면은 영향 없다.
 * 새 버전을 평소처럼 배포한 뒤 그 컨테이너에서 --apply로 만든다. 만든 즉시 강사 입력/백필이 동작한다(재배포 불필요).
 *
 *   Run as: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/apply-mongodb-instructor-engagement-collection.ts [args]
 *   점검(읽기 전용, 기본값):  (인자 없음)
 *   생성:                MONGODB_ALLOW_SHADOW_WRITES=true, --apply --confirm-target=<db>/<namespace> --backup-confirmed
 */
const MODELS = ["InstructorEngagement", "InstructorEngagementSchedule"] as const;

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
      await prepareMongoReadStore({ ...options, allowShadowWrites: true }, MODELS);
      await prepareMongoInstructorCatalogGuard(new MongoOperationStore(options, MODELS), true);
      console.log(JSON.stringify({ target, mode: "applied", models: MODELS, next: "Collections ready; 강사 입력/백필이 바로 동작(재배포 불필요)." }, null, 2));
      return;
    }
    const store = new MongoOperationStore(options, MODELS);
    try {
      await assertMongoReadStoreReady(store);
      await assertMongoInstructorCatalogGuardReady(store);
      console.log(JSON.stringify({ target, mode: "report", models: MODELS, ready: true }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ target, mode: "report", models: MODELS, ready: false, code: mongoFailureCode(error) }, null, 2));
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
