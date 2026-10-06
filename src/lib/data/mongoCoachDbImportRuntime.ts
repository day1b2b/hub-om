import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope,runWithDataRepositories,runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoCoachDbImportRepository } from "./mongoCoachDbImportRepository";
type Options=MongoOperationOptions&{allowShadowWrites:true};
export async function openMongoCoachDbImportRuntime(options:Options){try{const repositories=Object.freeze({coachDbImport:await MongoCoachDbImportRepository.open(options)});registerDataRepositoryScope(repositories);return Object.freeze({repositories,run<T>(work:()=>T):T{return runWithDataRepositories(repositories,()=>runWithLockedRepositoryScope(work));}});}catch{throw new Error("MONGO_COACH_DB_IMPORT_RUNTIME_FAILED");}}
