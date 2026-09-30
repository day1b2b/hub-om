import type { MongoOperationOptions } from "./mongoOperationStore";
import { MongoOperationStore } from "./mongoOperationStore";
import { mongoRuntimeContracts } from "./mongoRuntimeCodec";

const KNOWN_INTERNAL_COLLECTIONS = [
  "__creation", "__counter", "__teamUserWriteGuard", "CalendarOperationLease",
  "CoachCatalogGuard", "CoachSchedulingGuard", "CourseNameRestoreGuard",
] as const;

/** Read-only ownership check shared by explicit shadow runtime preparers. */
export async function hasKnownMongoRuntimeCollections(options: MongoOperationOptions): Promise<boolean> {
  const store = new MongoOperationStore(options, ["Company"]);
  const ownedNames = new Set([
    ...Object.keys(mongoRuntimeContracts).map(model => `${options.namespace}_${model}`),
    ...KNOWN_INTERNAL_COLLECTIONS.map(name => `${options.namespace}_${name}`),
  ]);
  const cursor = store.db.listCollections({}, { nameOnly: true, timeoutMS: 5000 });
  try {
    for await (const collection of cursor) if (ownedNames.has(collection.name)) return true;
    return false;
  } finally { await cursor.close({ timeoutMS: 5000 }); }
}
