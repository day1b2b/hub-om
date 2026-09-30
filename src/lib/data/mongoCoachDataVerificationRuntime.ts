import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoCoachDataVerificationRepository } from "./mongoCoachDataVerificationRepository";
export async function openMongoCoachDataVerificationRuntime(options: MongoOperationOptions) {
  try { const repositories = Object.freeze({ coachDataVerification: await MongoCoachDataVerificationRepository.open(options) }); registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } }); }
  catch { throw new Error("MONGO_COACH_DATA_VERIFICATION_RUNTIME_FAILED"); }
}
