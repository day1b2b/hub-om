import { getDataRepositoryOverride } from "./dataRepositoryContext";
import type { DuplicateCompanyMergeRepository } from "./duplicateCompanyMergeRepository";
import { PrismaDuplicateCompanyMergeRepository } from "./prismaDuplicateCompanyMergeRepository";
export function getDuplicateCompanyMergeRepository(): DuplicateCompanyMergeRepository {
  return getDataRepositoryOverride("duplicateCompanyMerge") ?? new PrismaDuplicateCompanyMergeRepository();
}
