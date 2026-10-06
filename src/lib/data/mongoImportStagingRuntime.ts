import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { IMPORT_MODELS, MongoImportRepository, prepareMongoImportStore } from "./mongoImportRepository";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { TEAM_READ_MODELS, prepareMongoReadStore } from "./mongoReadStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };
type TemplateRepositories = Readonly<Pick<DataRepositories, "requestActivity">>;
type UploadRepositories = Readonly<Pick<DataRepositories, "requestActivity" | "imports" | "teamMembers" | "instructorNote">>;
export const MONGO_IMPORT_TEMPLATE_MODELS = [...REQUEST_AUDIT_MODELS] as readonly string[];
export const MONGO_IMPORT_UPLOAD_MODELS = [...new Set([...IMPORT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS])] as readonly string[];

export async function prepareMongoImportTemplateRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_IMPORT_TEMPLATE_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoRequestAuditStore(options);
    return await openMongoImportTemplateRuntime(options);
  } catch { throw new Error("MONGO_IMPORT_TEMPLATE_RUNTIME_FAILED"); }
}

export async function openMongoImportTemplateRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_IMPORT_TEMPLATE_MODELS);
    const repositories: TemplateRepositories = Object.freeze({ requestActivity: await MongoRequestAuditRepository.open(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } });
  } catch { throw new Error("MONGO_IMPORT_TEMPLATE_RUNTIME_FAILED"); }
}

export async function prepareMongoImportUploadRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_IMPORT_UPLOAD_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoImportStore(options);
      await prepareMongoReadStore(options, TEAM_READ_MODELS);
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoImportUploadRuntime(options);
  } catch { throw new Error("MONGO_IMPORT_UPLOAD_RUNTIME_FAILED"); }
}

export async function openMongoImportUploadRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_IMPORT_UPLOAD_MODELS);
    const [imports, teamMembers, instructorNote, requestActivity] = await Promise.all([
      MongoImportRepository.open(options), MongoTeamMemberRepository.open(options), MongoInstructorNoteRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const repositories: UploadRepositories = Object.freeze({ imports, teamMembers, instructorNote, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } });
  } catch { throw new Error("MONGO_IMPORT_UPLOAD_RUNTIME_FAILED"); }
}
