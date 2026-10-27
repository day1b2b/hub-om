import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../src/lib/mongodb/connection";
import { privacyFields } from "../src/lib/privacy/fields";
import { mongoPrivacyViolations } from "../src/lib/migration/mongoPrivacyReadiness";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--read-only") throw new Error("ARGUMENTS");
  const namespace = process.env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!/^shadow_[A-Za-z0-9_-]{1,80}$/.test(namespace)) throw new Error("NAMESPACE");
  const client = new MongoClient(configuredMongoUri(), mongoConnectionOptions());
  let documentsScanned = 0;
  let fieldsChecked = 0;
  const violations = new Map<string, number>();
  try {
    await client.connect();
    const database = client.db(shadowDatabaseName());
    for (const [model, definition] of Object.entries(privacyFields)) {
      const projection = Object.fromEntries(Object.entries(definition.fields).map(([field, policy]) => [policy.storage ?? field, 1]));
      const cursor = database.collection(`${namespace}_${model}`).find({}, { projection, maxTimeMS: 15_000 }).batchSize(250);
      for await (const document of cursor) {
        documentsScanned++;
        fieldsChecked += Object.keys(definition.fields).length;
        for (const violation of mongoPrivacyViolations(model, document)) {
          const key = `${violation.model}.${violation.field}`;
          violations.set(key, (violations.get(key) ?? 0) + 1);
        }
      }
    }
    const violationCount = [...violations.values()].reduce((sum, count) => sum + count, 0);
    console.log(JSON.stringify({
      status: violationCount === 0 ? "privacy-ready" : "legacy-plaintext-found",
      documentsScanned,
      fieldsChecked,
      violationCount,
      violationFields: [...violations.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([field, count]) => ({ field, count })),
      readyForPlaintextReadsDisabled: violationCount === 0,
    }));
    if (violationCount !== 0) process.exitCode = 2;
  } finally { await client.close(); }
}

main().catch(() => {
  console.error(JSON.stringify({ status: "privacy-readiness-check-failed", readyForPlaintextReadsDisabled: false }));
  process.exitCode = 1;
});
