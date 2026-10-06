import { MongoClient } from "mongodb";
import { recoverMongoNamespace, MongoNamespaceRecoveryError } from "../src/lib/migration/mongoNamespaceRecovery";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../src/lib/mongodb/connection";

async function main() {
  const [sourceNamespace, targetNamespace, confirmation, ...extra] = process.argv.slice(2);
  if (!sourceNamespace || !targetNamespace || confirmation !== "--source-writes-frozen" || extra.length) throw new MongoNamespaceRecoveryError("ARGUMENTS");
  if (process.env.MONGODB_ALLOW_SHADOW_WRITES !== "true") throw new MongoNamespaceRecoveryError("SHADOW_WRITE_GATE");
  const databaseName = shadowDatabaseName();
  const client = new MongoClient(configuredMongoUri(), mongoConnectionOptions());
  try {
    await client.connect();
    const result = await recoverMongoNamespace({ client, databaseName, sourceNamespace, targetNamespace, sourceWritesFrozen: true });
    console.log(JSON.stringify(result));
  } finally { await client.close(); }
}

main().catch((error: unknown) => {
  const code = error instanceof MongoNamespaceRecoveryError ? error.code : "NAMESPACE_RECOVERY_FAILED";
  console.error(JSON.stringify({ code, recovered: false, cutoverAuthorized: false }));
  process.exitCode = 1;
});
