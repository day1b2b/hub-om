import { MongoCodecError } from "../src/lib/migration/mongoDocumentCodec";
import { importMongoShadowSpool } from "../src/lib/migration/mongoShadowImport";
import { ShadowTransferError } from "../src/lib/migration/mongoShadowTransfer";
import { MongoPreparationError } from "../src/lib/mongodb/connection";
import { openMongoShadowTarget } from "../src/lib/mongodb/shadowTarget";

async function main() {
  const [directory, runId, confirmation, ...extra] = process.argv.slice(2);
  if (!directory || !runId || confirmation !== "--apply-shadow-only" || extra.length) throw new Error("arguments");
  const productionDatabase = process.env.MONGODB_PRODUCTION_DATABASE;
  if (!productionDatabase || productionDatabase === process.env.MONGODB_SHADOW_DATABASE) throw new Error("database gate");
  // Fully validate files, ciphertext, and manifest before connecting to the destination.
  const { loadMongoShadowSpool } = await import("../src/lib/migration/mongoShadowImport");
  await loadMongoShadowSpool(directory);
  const { target, client } = await openMongoShadowTarget();
  try { console.log(JSON.stringify(await importMongoShadowSpool(directory, runId, target, productionDatabase, true))); }
  finally { await client.close(); }
}
main().catch((error: unknown) => {
  const code = error instanceof ShadowTransferError || error instanceof MongoPreparationError || error instanceof MongoCodecError
    ? error.code
    : "SHADOW_IMPORT_FAILED";
  console.error(JSON.stringify({ code, readyForCutover: false }));
  process.exitCode = 1;
});
