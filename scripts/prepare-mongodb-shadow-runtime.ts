import { MongoClient } from "mongodb";
import { mongoModelNames } from "../src/lib/migration/mongoDocumentCodec";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../src/lib/mongodb/connection";
import { prepareMongoOperationStore } from "../src/lib/data/mongoOperationStore";
import { prepareMongoReadStore } from "../src/lib/data/mongoReadStore";
import { prepareMongoRequestAuditStore } from "../src/lib/data/mongoRequestAuditRepository";

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
    await prepareMongoOperationStore({ ...options, processSequenceHighWater });
    await prepareMongoRequestAuditStore(options);
    console.log(JSON.stringify({ status: "shadow-runtime-ready", modelCount: mongoModelNames.length, namespace, readyForCutover: false }));
  } finally {
    await client.close();
  }
}

main().catch(() => {
  console.error(JSON.stringify({ code: "SHADOW_RUNTIME_PREPARE_FAILED", readyForCutover: false }));
  process.exitCode = 1;
});
