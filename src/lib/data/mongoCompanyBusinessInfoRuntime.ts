import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoCompanyBusinessInfoRepository } from "./mongoCompanyBusinessInfoRepository";
import type { MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository } from "./mongoRequestAuditRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoCompanyBusinessInfoRepositories = Readonly<Pick<DataRepositories, "companyBusinessInfo" | "requestActivity">>;

export interface MongoCompanyBusinessInfoRuntime {
  readonly repositories: MongoCompanyBusinessInfoRepositories;
  run<T>(work: () => T): T;
}

/** Company 컬렉션은 overview-pages/operation Mongo 런타임이 이미 준비해 둔다 — 여기서는 열기만 한다.
 * withActivity가 요청을 시작하자마자 이 범위에서 requestActivity를 꺼내므로 반드시 함께 연다 —
 * 빠지면 모든 요청이 처리 전에 DATA_REPOSITORY_NOT_CONFIGURED로 실패한다. */
export async function openMongoCompanyBusinessInfoRuntime(options: Options): Promise<MongoCompanyBusinessInfoRuntime> {
  try {
    const [companyBusinessInfo, requestActivity] = await Promise.all([
      MongoCompanyBusinessInfoRepository.open(options),
      MongoRequestAuditRepository.open(options)
    ]);
    const repositories: MongoCompanyBusinessInfoRepositories = Object.freeze({ companyBusinessInfo, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({
      repositories,
      run<T>(work: () => T): T {
        return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
      }
    });
  } catch {
    throw new Error("MONGO_COMPANY_BUSINESS_INFO_RUNTIME_FAILED");
  }
}
