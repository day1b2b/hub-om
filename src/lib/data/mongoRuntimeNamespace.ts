import type { MongoOperationOptions } from "./mongoOperationStore";
import { MongoOperationStore } from "./mongoOperationStore";

/**
 * Read-only ownership check shared by explicit shadow runtime preparers.
 * Any collection under the namespace makes it non-empty. Unknown or legacy
 * collections must reach the ordinary readiness check and fail without repair.
 */
export async function hasKnownMongoRuntimeCollections(options: MongoOperationOptions): Promise<boolean> {
  const store = new MongoOperationStore(options, ["Company"]);
  const prefix = `${options.namespace}_`;
  const cursor = store.db.listCollections({}, { nameOnly: true, timeoutMS: 5000 });
  try {
    for await (const collection of cursor) if (collection.name.startsWith(prefix)) return true;
    return false;
  } finally { await cursor.close({ timeoutMS: 5000 }); }
}
