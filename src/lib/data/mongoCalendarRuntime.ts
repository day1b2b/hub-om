import { backfillMissingCalendarEvents } from "../googleCalendar/backfillCalendarEvents";
import { assertCalendarScopeReady } from "../googleCalendar/calendarScope";
import { CalendarReflectingOperationRepository } from "./calendarReflectingOperationRepository";
import { getDataRepositoryOverride, registerDataRepositoryScope, runWithDataRepositories, type DataRepositories } from "./dataRepositoryContext";
import { MongoCalendarOperationLock, prepareMongoCalendarLeaseStore, type MongoCalendarOptions } from "./mongoCalendarOperationLock";
import { MongoCalendarPersistence, prepareMongoCalendarPersistenceStore } from "./mongoCalendarPersistence";
import { MongoImportPromotionRepository, prepareMongoImportPromotionStore } from "./mongoImportPromotionRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { prepareMongoOperationStore } from "./mongoOperationStore";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { MongoTeamUserRepository, prepareMongoTeamUserStore } from "./teamUsers/mongoTeamUserRepository";

type ScopeKey = "operations" | "teamUsers" | "teamMembers" | "importPromotion" | "importPromotionCalendar" | "requestActivity" | "calendarPersistence" | "calendarLock";
export type MongoCalendarRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
/** Explicit setup, never called by open/runtime or a production factory. */
export async function prepareMongoCalendarRuntimeStore(options: MongoCalendarOptions & { processSequenceHighWater: number }): Promise<void> {
  await prepareMongoCalendarPersistenceStore(options);
  await prepareMongoCalendarLeaseStore(options);
  await prepareMongoOperationStore(options);
  await prepareMongoImportPromotionStore(options);
  await prepareMongoReadStore(options, TEAM_READ_MODELS);
  await prepareMongoTeamUserStore(options);
  await prepareMongoRequestAuditStore(options);
}
/** No environment selector and no credentials. All ports are opened on one client/database/namespace. */
export async function openMongoCalendarRuntime(options: MongoCalendarOptions & { reflectOperations?: boolean }) {
  const lock = await MongoCalendarOperationLock.open(options);
  const [persistence, rawOperations, teamUsers, teamMembers, importPromotion, requestActivity] = await Promise.all([
    MongoCalendarPersistence.open(options, lock), MongoOperationRepository.open(options), MongoTeamUserRepository.open(options),
    MongoTeamMemberRepository.open(options), MongoImportPromotionRepository.open(options), MongoRequestAuditRepository.open(options)
  ]);
  // Choose the final wrapper before registering object identities. Never replace
  // a registered port afterwards or silently wrap an arbitrary context override.
  const operations = options.reflectOperations ? new CalendarReflectingOperationRepository(rawOperations) : rawOperations;
  const assertReady = () => {
    assertCalendarScopeReady();
    for (const key of Object.keys(repositories) as ScopeKey[]) {
      if (getDataRepositoryOverride(key) !== repositories[key]) throw new Error("CALENDAR_SCOPE_MISMATCH");
    }
  };
  const repositories: MongoCalendarRepositories = Object.freeze({
    operations, teamUsers, teamMembers, importPromotion, requestActivity,
    calendarPersistence: persistence, calendarLock: lock,
    importPromotionCalendar: Object.freeze({ assertReady, backfillMissingCalendarEvents })
  });
  registerDataRepositoryScope(repositories);
  return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, work); } });
}
