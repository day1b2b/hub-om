import { openMongoCalendarRuntime, prepareMongoCalendarRuntimeStore } from "./mongoCalendarRuntime";
import type { MongoCalendarOptions } from "./mongoCalendarOperationLock";
import { MongoOperationStore } from "./mongoOperationStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

type Options = MongoCalendarOptions & { processSequenceHighWater: number };
export type MongoOperationWriteRuntime = Awaited<ReturnType<typeof openMongoCalendarRuntime>>;

/** Opens the prepared Calendar-aware operation scope without schema repair or environment selection. */
export async function openMongoOperationWriteRuntime(options: MongoCalendarOptions): Promise<MongoOperationWriteRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options);
    return await openMongoCalendarRuntime({ ...options, reflectOperations: true });
  } catch { throw new Error("MONGO_OPERATION_WRITE_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace; existing state receives a read-only readiness check. */
export async function prepareMongoOperationWriteRuntime(options: Options): Promise<MongoOperationWriteRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options);
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoCalendarRuntimeStore(options);
    return await openMongoOperationWriteRuntime(options);
  } catch { throw new Error("MONGO_OPERATION_WRITE_RUNTIME_FAILED"); }
}
