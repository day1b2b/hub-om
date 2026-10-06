import type { MongoDuplicateCompanyMergeOptions } from "./mongoDuplicateCompanyMergeRepository";
import { MongoDuplicateCompanyMergeRepository } from "./mongoDuplicateCompanyMergeRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
export async function openMongoDuplicateCompanyMergeRuntime(options: MongoDuplicateCompanyMergeOptions) {
  const duplicateCompanyMerge = await MongoDuplicateCompanyMergeRepository.open(options);
  return { run<T>(work: () => Promise<T>) { return runWithDataRepositories({ duplicateCompanyMerge }, work); } };
}
