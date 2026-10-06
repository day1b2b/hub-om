import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import type { GoogleSheetsImportSource } from "./googleSheetsImportSource";
import { IMPORT_MODELS, MongoImportRepository, prepareMongoImportStore } from "./mongoImportRepository";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { TEAM_READ_MODELS, prepareMongoReadStore } from "./mongoReadStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true; googleSheetsImportSource: GoogleSheetsImportSource };
type TabsRepositories = Readonly<Pick<DataRepositories, "googleSheetsImportSource" | "requestActivity">>;
type ImportRepositories = Readonly<Pick<DataRepositories, "googleSheetsImportSource" | "requestActivity" | "imports" | "teamMembers" | "instructorNote">>;
export const MONGO_GOOGLE_SHEETS_TABS_MODELS = [...REQUEST_AUDIT_MODELS] as readonly string[];
export const MONGO_GOOGLE_SHEETS_IMPORT_MODELS = [...new Set([...IMPORT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS])] as readonly string[];

function source(options: Options): GoogleSheetsImportSource {
  return Object.freeze({
    listTabs: (...args: Parameters<GoogleSheetsImportSource["listTabs"]>) => options.googleSheetsImportSource.listTabs(...args),
    readRows: (...args: Parameters<GoogleSheetsImportSource["readRows"]>) => options.googleSheetsImportSource.readRows(...args)
  });
}

export async function prepareMongoGoogleSheetsTabsRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_GOOGLE_SHEETS_TABS_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoRequestAuditStore(options);
    return await openMongoGoogleSheetsTabsRuntime(options);
  } catch { throw new Error("MONGO_GOOGLE_SHEETS_TABS_RUNTIME_FAILED"); }
}

export async function openMongoGoogleSheetsTabsRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_GOOGLE_SHEETS_TABS_MODELS);
    const requestActivity = await MongoRequestAuditRepository.open(options);
    const repositories: TabsRepositories = Object.freeze({ requestActivity, googleSheetsImportSource: source(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } });
  } catch { throw new Error("MONGO_GOOGLE_SHEETS_TABS_RUNTIME_FAILED"); }
}

export async function prepareMongoGoogleSheetsImportRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_GOOGLE_SHEETS_IMPORT_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoImportStore(options); await prepareMongoReadStore(options, TEAM_READ_MODELS);
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS); await prepareMongoRequestAuditStore(options);
    }
    return await openMongoGoogleSheetsImportRuntime(options);
  } catch { throw new Error("MONGO_GOOGLE_SHEETS_IMPORT_RUNTIME_FAILED"); }
}

export async function openMongoGoogleSheetsImportRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_GOOGLE_SHEETS_IMPORT_MODELS);
    const [imports, teamMembers, instructorNote, requestActivity] = await Promise.all([
      MongoImportRepository.open(options), MongoTeamMemberRepository.open(options), MongoInstructorNoteRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const repositories: ImportRepositories = Object.freeze({ imports, teamMembers, instructorNote, requestActivity, googleSheetsImportSource: source(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } });
  } catch { throw new Error("MONGO_GOOGLE_SHEETS_IMPORT_RUNTIME_FAILED"); }
}
