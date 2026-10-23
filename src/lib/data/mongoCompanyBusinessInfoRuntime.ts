import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoCompanyBusinessInfoRepository } from "./mongoCompanyBusinessInfoRepository";
import type { MongoOperationOptions } from "./mongoOperationStore";

type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoCompanyBusinessInfoRepositories = Readonly<Pick<DataRepositories, "companyBusinessInfo">>;

export interface MongoCompanyBusinessInfoRuntime {
  readonly repositories: MongoCompanyBusinessInfoRepositories;
  run<T>(work: () => T): T;
}

/** Company 컬렉션은 overview-pages/operation Mongo 런타임이 이미 준비해 둔다 — 여기서는 열기만 한다. */
export async function openMongoCompanyBusinessInfoRuntime(options: Options): Promise<MongoCompanyBusinessInfoRuntime> {
  try {
    const companyBusinessInfo = await MongoCompanyBusinessInfoRepository.open(options);
    const repositories: MongoCompanyBusinessInfoRepositories = Object.freeze({ companyBusinessInfo });
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
