import { randomUUID } from "node:crypto";
import { mkdir, open, link, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ShadowDocument } from "./mongoShadowTransfer";

export interface PostgresExportSnapshot {
  snapshotId: string;
  isolation: "repeatable-read";
  readOnly: true;
  /** Pages must follow the exact codec id ordering, within one open transaction. */
  page(model: string, afterId: string | null, limit: number): Promise<Record<string, unknown>[]>;
  /** Values are decimal strings; sequences are not MVCC, so this is not a cutover guarantee. */
  sequenceHighWater(): Promise<Record<string, string>>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}
export interface PostgresExportCodec {
  models: readonly string[];
  encode(model: string, row: Record<string, unknown>, mode: "plaintext" | "encrypted"): ShadowDocument;
  hash(model: string, document: ShadowDocument): string;
}
export type ShadowExportManifest = {
  version: 1;
  snapshotId: string;
  sourceConsistency: "exported-snapshot";
  sourceMode: "plaintext" | "encrypted";
  models: Record<string, { file: string; count: number; digest: string }>;
  sequenceHighWater: Record<string, string>;
  sequenceValuesRequireFrozenRecheck: true;
  cutoverAuthorized: false;
};
export class PostgresShadowExportError extends Error {
  readonly code: string;
  constructor(code: string) { super(`PostgreSQL shadow export failed: ${code}`); this.code = code; }
}
function ensure(value: unknown, code: string): asserts value {
  if (!value) throw new PostgresShadowExportError(code);
}
/**
 * Encode before any row reaches disk. Publish manifest only after every file is
 * synced and the read-only transaction finishes. Incomplete directories are never
 * resumable exports; retry into a new namespace, preserving evidence of failure.
 */
export async function exportPostgresShadow(options: {
  directory: string;
  sourceMode: "plaintext" | "encrypted";
  snapshot: PostgresExportSnapshot;
  codec: PostgresExportCodec;
  batchSize?: number;
  maxRows?: number;
}): Promise<{ directory: string; manifest: ShadowExportManifest }> {
  const { snapshot, codec } = options;
  let finished = false;
  try {
    ensure(snapshot.isolation === "repeatable-read" && snapshot.readOnly === true &&
      typeof snapshot.snapshotId === "string" && snapshot.snapshotId.length > 0, "READ_ONLY_SNAPSHOT_REQUIRED");
    ensure(options.sourceMode === "plaintext" || options.sourceMode === "encrypted", "SOURCE_MODE_REQUIRED");
    const batch = options.batchSize ?? 100;
    const maxRows = options.maxRows ?? 1_000_000;
    ensure(Number.isSafeInteger(batch) && batch > 0 && batch <= 1000 && Number.isSafeInteger(maxRows) && maxRows > 0, "BOUNDS");
    const models = [...codec.models].sort();
    ensure(models.length > 0 && new Set(models).size === models.length && models.every(model => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(model)), "MODEL_COVERAGE");
    // Exclusive new directory prevents overwriting a previously committed spool.
    await mkdir(options.directory, { mode: 0o700 });
    const manifest: ShadowExportManifest = { version: 1, snapshotId: snapshot.snapshotId,
      sourceConsistency: "exported-snapshot", sourceMode: options.sourceMode, models: {}, sequenceHighWater: {},
      sequenceValuesRequireFrozenRecheck: true, cutoverAuthorized: false };
    let total = 0;
    for (const model of models) {
      const file = `${model}.jsonl`;
      const handle = await open(path.join(options.directory, file), "wx", 0o600);
      try {
        let after: string | null = null;
        let count = 0;
        const digest = createHash("sha256");
        while (true) {
          const rows = await snapshot.page(model, after, batch);
          ensure(Array.isArray(rows) && rows.length <= batch, "SOURCE_PAGE");
          if (!rows.length) break;
          for (const row of rows) {
            const document = codec.encode(model, row, options.sourceMode);
            ensure(typeof document._id === "string" && document._id.length > 0 && (after === null || document._id > after), "SOURCE_ORDER");
            ensure(++total <= maxRows, "ROW_LIMIT");
            const hash = codec.hash(model, document);
            ensure(/^[a-f0-9]{64}$/.test(hash), "DOCUMENT_HASH");
            // The codec must authenticate/validate the full encoded document here.
            await handle.writeFile(JSON.stringify(document) + "\n", "utf8");
            digest.update(JSON.stringify([document._id, hash]) + "\n");
            after = document._id;
            count++;
          }
        }
        await handle.sync();
        manifest.models[model] = { file, count, digest: digest.digest("hex") };
      } finally { await handle.close(); }
    }
    const highWater = await snapshot.sequenceHighWater();
    ensure(highWater !== null && typeof highWater === "object" && !Array.isArray(highWater), "SEQUENCE_METADATA");
    for (const [name, value] of Object.entries(highWater)) {
      ensure(/^[A-Za-z_][A-Za-z0-9_.]{0,159}$/.test(name) && typeof value === "string" && /^-?\d+$/.test(value), "SEQUENCE_METADATA");
    }
    manifest.sequenceHighWater = highWater;
    await snapshot.finish();
    finished = true;
    // wx + fsync + directory fsync: no consumer may use a directory without this marker.
    const marker = await open(path.join(options.directory, "manifest.pending"), "wx", 0o600);
    try { await marker.writeFile(JSON.stringify(manifest) + "\n"); await marker.sync(); }
    finally { await marker.close(); }
    await link(path.join(options.directory, "manifest.pending"), path.join(options.directory, "manifest.json"));
    await unlink(path.join(options.directory, "manifest.pending"));
    const directory = await open(options.directory, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return { directory: options.directory, manifest };
  } catch (error) {
    if (!finished) { try { await snapshot.abort(); } catch { /* Never disclose connection/query errors. */ } }
    if (error instanceof PostgresShadowExportError) throw error;
    throw new PostgresShadowExportError("EXPORT_FAILED");
  }
}

/** Random directory names carry no source identities or customer information. */
export function newShadowExportDirectory(parent: string): string {
  return path.join(parent, `mongo-shadow-${randomUUID()}`);
}
