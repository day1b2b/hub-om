import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { IMPORT_MODELS, MongoImportRepository } from "./mongoImportRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";

type Options=MongoOperationOptions&{allowShadowWrites:true};
type Repositories=Readonly<Pick<DataRepositories,"imports">>;
export const MONGO_IMPORT_PAGES_MODELS=[...IMPORT_MODELS] as readonly string[];
export async function openMongoImportPagesRuntime(options:Options){try{if(options.allowShadowWrites!==true)throw new Error("gate");new MongoOperationStore(options,MONGO_IMPORT_PAGES_MODELS);const repositories:Repositories=Object.freeze({imports:await MongoImportRepository.open(options)});registerDataRepositoryScope(repositories);return Object.freeze({repositories,run<T>(work:()=>T):T{return runWithDataRepositories(repositories,()=>runWithLockedRepositoryScope(work));}});}catch{throw new Error("MONGO_IMPORT_PAGES_RUNTIME_FAILED");}}
