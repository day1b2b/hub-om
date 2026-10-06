import { MongoClient } from "mongodb";
import { mongoModelNames } from "../src/lib/migration/mongoDocumentCodec";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../src/lib/mongodb/connection";
import { prepareMongoReadStore } from "../src/lib/data/mongoReadStore";
import { prepareMongoCalendarRuntimeStore } from "../src/lib/data/mongoCalendarRuntime";
import { openMongoOperationWriteRuntime } from "../src/lib/data/mongoOperationWriteRuntime";
import { openMongoOmRequestWriteRuntime } from "../src/lib/data/mongoOmRequestWriteRuntime";

async function main() {
  const [namespace, sequence, confirmation, ...extra] = process.argv.slice(2);
  if (!/^shadow_[A-Za-z0-9_-]{1,80}$/.test(namespace ?? "") || !/^\d+$/.test(sequence ?? "") || confirmation !== "--apply-shadow-only" || extra.length) throw new Error("arguments");
  if (process.env.MONGODB_ALLOW_SHADOW_WRITES !== "true") throw new Error("write gate");
  const processSequenceHighWater = Number(sequence);
  if (!Number.isSafeInteger(processSequenceHighWater) || processSequenceHighWater < 0 || processSequenceHighWater >= 2_147_483_647) throw new Error("sequence");
  const databaseName = shadowDatabaseName();
  const client = new MongoClient(configuredMongoUri(), mongoConnectionOptions());
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    // Validate every copied document before adopting the runtime validators and indexes.
    await prepareMongoReadStore(options, mongoModelNames);
    // Operation and OM-request writes share this Calendar-aware boundary. It
    // also prepares the operation store, request audit, internal lease
    // collection and TeamUser write guard required by production open-only
    // runtimes.
    await prepareMongoCalendarRuntimeStore({ ...options, processSequenceHighWater });
    await openMongoOperationWriteRuntime(options);
    await openMongoOmRequestWriteRuntime({ ...options,
      omAssignmentCalendar: { async reflectOperationUpdated() {} },
      omAssignmentNotifier: { async notifyAssigned() {} },
      omCustomTools: { list: () => [], add() {} },
      omRequestNotifier: { async notifyCreated() { return null; } },
    });
    console.log(JSON.stringify({ status: "shadow-runtime-ready", modelCount: mongoModelNames.length, namespace, readyForCutover: false }));
  } finally {
    await client.close();
  }
}

main().catch(() => {
  console.error(JSON.stringify({ code: "SHADOW_RUNTIME_PREPARE_FAILED", readyForCutover: false }));
  process.exitCode = 1;
});
