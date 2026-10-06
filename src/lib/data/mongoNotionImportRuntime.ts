import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { IMPORT_MODELS, MongoImportRepository, prepareMongoImportStore } from "./mongoImportRepository";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { TEAM_READ_MODELS, prepareMongoReadStore } from "./mongoReadStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import type { NotionImportSource } from "./notionImportSource";

type ScopeKey = "imports" | "teamMembers" | "instructorNote" | "requestActivity" | "notionImportSource";
type Options = MongoOperationOptions & { allowShadowWrites: true; notionImportSource: NotionImportSource };
export type MongoNotionImportRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_NOTION_IMPORT_RUNTIME_MODELS = [...new Set([
  ...IMPORT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS
])] as readonly string[];

export async function prepareMongoNotionImportRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_NOTION_IMPORT_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoImportStore(options);
      await prepareMongoReadStore(options, TEAM_READ_MODELS);
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoNotionImportRuntime(options);
  } catch { throw new Error("MONGO_NOTION_IMPORT_RUNTIME_FAILED"); }
}

export async function openMongoNotionImportRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_NOTION_IMPORT_RUNTIME_MODELS);
    const [imports, teamMembers, instructorNote, requestActivity] = await Promise.all([
      MongoImportRepository.open(options), MongoTeamMemberRepository.open(options),
      MongoInstructorNoteRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const notionImportSource: NotionImportSource = Object.freeze({
      readDatabase: (input: Parameters<NotionImportSource["readDatabase"]>[0]) => options.notionImportSource.readDatabase(input)
    });
    const repositories: MongoNotionImportRepositories = Object.freeze({ imports, teamMembers, instructorNote, requestActivity, notionImportSource });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_NOTION_IMPORT_RUNTIME_FAILED"); }
}
