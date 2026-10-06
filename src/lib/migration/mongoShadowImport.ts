import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { mongoModelContracts, mongoModelNames, hashMongoDocument, type CanonicalDocument } from "./mongoDocumentCodec";
import { shadowContentDigest, transferMongoShadow, ShadowTransferError, type ShadowSource, type ShadowTarget, type ShadowDocument } from "./mongoShadowTransfer";
import type { ShadowExportManifest } from "./postgresShadowExport";

const check = (condition: unknown, code: string) => { if (!condition) throw new ShadowTransferError(code); };
async function readBounded(file: string, maximum: number) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    check(stat.isFile() && stat.size <= maximum, "SPOOL_FILE_LIMIT");
    // Enforce the bound while reading, including a file that grows after stat().
    const chunks: Buffer[] = []; let length = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximum - length + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
      check(length <= maximum, "SPOOL_FILE_LIMIT");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, length).toString("utf8");
  } finally { await handle.close(); }
}
/** Bounded immutable in-memory snapshot, not an unbounded production streaming loader. */
export async function loadMongoShadowSpool(directory: string) {
  const text = await readBounded(path.join(directory, "manifest.json"), 1024 * 1024);
  const manifest = JSON.parse(text) as ShadowExportManifest;
  check(manifest && typeof manifest === "object" && Object.keys(manifest).sort().join() === "cutoverAuthorized,models,sequenceHighWater,sequenceValuesRequireFrozenRecheck,snapshotId,sourceConsistency,sourceMode,version", "SPOOL_MANIFEST");
  check(["plaintext", "encrypted"].includes(manifest.sourceMode) && manifest.sequenceValuesRequireFrozenRecheck === true && manifest.sequenceHighWater && typeof manifest.sequenceHighWater === "object" && !Array.isArray(manifest.sequenceHighWater), "SPOOL_SEQUENCE_OR_MODE");
  check(Object.entries(manifest.sequenceHighWater).every(([name, value]) => /^public\.[A-Za-z_][A-Za-z0-9_]*$/.test(name) && typeof value === "string" && /^-?\d+$/.test(value)), "SPOOL_SEQUENCE_OR_MODE");
  check(manifest.version === 1 && manifest.sourceConsistency === "exported-snapshot" && typeof manifest.snapshotId === "string" && manifest.snapshotId.length > 0 && manifest.cutoverAuthorized === false, "SPOOL_MANIFEST");
  check(JSON.stringify(Object.keys(manifest.models).sort()) === JSON.stringify([...mongoModelNames].sort()), "SPOOL_MODEL_COVERAGE");
  const data = new Map<string, CanonicalDocument[]>();
  let totalBytes = 0, totalRows = 0;
  for (const model of mongoModelNames) {
    const entry = manifest.models[model];
    check(entry && typeof entry === "object" && Object.keys(entry).sort().join() === "count,digest,file", "SPOOL_ENTRY");
    check(entry.file === `${model}.jsonl` && Number.isSafeInteger(entry.count) && entry.count >= 0 && /^[a-f0-9]{64}$/.test(entry.digest), "SPOOL_ENTRY");
    const body = await readBounded(path.join(directory, entry.file), 32 * 1024 * 1024);
    totalBytes += Buffer.byteLength(body);
    check(totalBytes <= 128 * 1024 * 1024, "SPOOL_TOTAL_LIMIT");
    const lines = body === "" ? [] : body.endsWith("\n") ? body.slice(0, -1).split("\n") : [];
    check(body === "" || body.endsWith("\n"), "SPOOL_TRUNCATED");
    let previous: string | null = null;
    const rows = lines.map(line => {
      const row = JSON.parse(line) as CanonicalDocument;
      check(typeof row._id === "string" && (previous === null || row._id > previous), "SPOOL_ORDER");
      previous = row._id;
      hashMongoDocument(model, row);
      return row;
    });
    totalRows += rows.length;
    check(totalRows <= 1_000_000 && rows.length === entry.count && shadowContentDigest(rows.map(row => ({ id: row._id, hash: hashMongoDocument(model, row) }))) === entry.digest, "SPOOL_CONTENT_MISMATCH");
    data.set(model, rows);
  }
  const source: ShadowSource = {
    async assertSnapshot(snapshotId) { check(snapshotId === manifest.snapshotId, "SPOOL_SNAPSHOT_MISMATCH"); },
    async page(snapshotId, model, afterId, limit) {
      await this.assertSnapshot(snapshotId);
      check(data.has(model), "UNKNOWN_MODEL");
      return structuredClone(data.get(model)!.filter(row => afterId === null || row._id > afterId).slice(0, limit));
    },
  };
  return { manifest, source };
}
function value(document: ShadowDocument, field: string) { return document[field === "id" ? "_id" : field]; }

/** Independent target scan: every declared FK and logical unique key, including HMAC keys. */
export async function verifyMongoShadowRelations(target: ShadowTarget, namespace: string) {
  const indexes = new Map<string, Set<string>>();
  const references: { target: string; key: string }[] = [];
  const evidence = createHash("sha256"); let total = 0;
  for (const model of mongoModelNames) {
    const contract = mongoModelContracts[model];
    const referencedKeys = mongoModelNames.flatMap(name => mongoModelContracts[name].references.filter(reference => reference.targetModel === model).map(reference => reference.targetFields));
    const keys = [...new Map([...contract.uniqueKeys.map(key => key.fields), ...referencedKeys].map(fields => [JSON.stringify(fields), fields])).values()];
    const uniqueFields = new Set(contract.uniqueKeys.map(key => JSON.stringify(key.fields)));
    for (const fields of keys) indexes.set(JSON.stringify([model, fields]), new Set());
    let after: string | null = null;
    while (true) {
      const rows = await target.page(namespace, model, after, 100);
      if (!rows.length) break;
      for (const row of rows) {
        check(++total <= 1_000_000 && (after === null || row._id > after), "RELATION_SCAN_LIMIT_OR_ORDER");
        evidence.update(hashMongoDocument(model, row as CanonicalDocument));
        for (const fields of keys) {
          const values = fields.map(field => value(row, field));
          if (values.some(entry => entry === null)) continue; // PostgreSQL NULLS DISTINCT.
          const key = JSON.stringify(values), index = indexes.get(JSON.stringify([model, fields]))!;
          if (uniqueFields.has(JSON.stringify(fields))) check(!index.has(key), "TARGET_UNIQUE_VIOLATION");
          index.add(key);
        }
        for (const reference of contract.references) {
          const values = reference.fields.map(field => value(row, field));
          if (values.some(entry => entry === null)) continue; // PostgreSQL MATCH SIMPLE.
          references.push({ target: JSON.stringify([reference.targetModel, reference.targetFields]), key: JSON.stringify(values) });
        }
        after = row._id;
      }
    }
  }
  for (const reference of references) check(indexes.get(reference.target)?.has(reference.key), "TARGET_FOREIGN_KEY_VIOLATION");
  return { verified: true as const, evidenceId: evidence.digest("hex") };
}
export async function importMongoShadowSpool(directory: string, runId: string, target: ShadowTarget, productionDatabase: string, allowShadowWrites: boolean) {
  check(allowShadowWrites === true, "SHADOW_WRITE_GATE");
  const { source, manifest } = await loadMongoShadowSpool(directory);
  return transferMongoShadow({ runId, snapshotId: manifest.snapshotId, sourceConsistency: "exported-snapshot", targetDatabase: target.databaseName, productionDatabase, allowShadowWrites: true,
    expected: Object.fromEntries(Object.entries(manifest.models).map(([model, entry]) => [model, { count: entry.count, digest: entry.digest }])) }, source, target,
  { models: mongoModelNames, encode(model, row) { hashMongoDocument(model, row as CanonicalDocument); return row as CanonicalDocument; }, hash: (model, row) => hashMongoDocument(model, row as CanonicalDocument) },
  ({ namespace }) => verifyMongoShadowRelations(target, namespace));
}
