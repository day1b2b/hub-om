import type { DataRepositories } from "./dataRepositoryContext";
import {
  registerDataRepositoryScope,
  runWithDataRepositories,
  runWithLockedRepositoryScope
} from "./dataRepositoryContext";
import { MongoDatabaseHealthRepository } from "./mongoDatabaseHealthRepository";
import type { MongoOperationOptions } from "./mongoOperationStore";

type Repositories = Readonly<Pick<DataRepositories, "databaseHealth">>;

export function openMongoHealthRuntime(options: MongoOperationOptions) {
  try {
    const repositories: Repositories = Object.freeze({
      // Same read-only readiness the operation runtimes run on open; a contract/validator mismatch fails health.
      // Loaded on use so the health route's import graph stays ping-only.
      databaseHealth: new MongoDatabaseHealthRepository(options.client, options.databaseName, async () => {
        const { assertMongoOperationStoreReady, MongoOperationStore } = await import("./mongoOperationStore");
        await assertMongoOperationStoreReady(new MongoOperationStore(options));
        // TeamUserDeparture는 OPERATION_MODELS 밖의 컬렉션이라 위 검사에 포함되지 않는다.
        // 컬렉션 생성 순서를 놓치면 위 검사는 통과하고 배포가 "성공"한 뒤, 이 컬렉션을 읽는
        // 화면(운영 상세·운영 현황·캘린더·멤버 관리·OM 요청 등, mongodb-team-user-departure-collection.md
        // 참고)만 나중에 VALIDATOR_NOT_READY로 500이 난다. 헬스체크 단계에서 먼저 검사해 배포 자체를 막는다.
        const { assertMongoReadStoreReady } = await import("./mongoReadStore");
        await assertMongoReadStoreReady(new MongoOperationStore(options, ["TeamUserDeparture"]));
      })
    });
    registerDataRepositoryScope(repositories);
    return Object.freeze({
      repositories,
      run<T>(work: () => T): T {
        return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
      }
    });
  } catch {
    throw new Error("MONGO_HEALTH_RUNTIME_FAILED");
  }
}
