import { createHash } from "node:crypto";

export type ShadowDocument = Record<string, unknown> & { _id: string };
export interface ShadowCodec {
  models: readonly string[];
  encode(model: string, row: unknown): ShadowDocument;
  /** Must reject invalid documents and return a canonical, exact-content SHA-256. */
  hash(model: string, document: ShadowDocument): string;
}
export interface ShadowSource {
  /** Adapter must bind every page to the same exported snapshot or frozen source. */
  assertSnapshot(snapshotId: string): Promise<void>;
  page(snapshotId: string, model: string, afterId: string | null, limit: number): Promise<unknown[]>;
}
export interface ShadowTarget {
  databaseName: string;
  /** Atomic insert, never upsert/replace; false means the id already exists. */
  insertOnly(namespace: string, model: string, document: ShadowDocument): Promise<boolean>;
  get(namespace: string, model: string, id: string): Promise<ShadowDocument | null>;
  /** Strict ascending _id, exclusive cursor; no hidden or filtered documents. */
  page(namespace: string, model: string, afterId: string | null, limit: number): Promise<ShadowDocument[]>;
  count(namespace: string, model: string): Promise<number>;
}
export type ShadowPlan = {
  runId: string;
  snapshotId: string;
  sourceConsistency: "exported-snapshot" | "frozen-source";
  targetDatabase: string;
  productionDatabase: string;
  allowShadowWrites: true;
  /** Counts and ordered content digests independently obtained from this snapshot. */
  expected: Record<string, { count: number; digest: string }>;
  batchSize?: number;
  maxRows?: number;
};
export class ShadowTransferError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Shadow transfer failed: ${code}`); this.code = code; }
}
function check(value: unknown, code: string): asserts value {
  if (!value) throw new ShadowTransferError(code);
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
/** Ordered rows are framed so arbitrary ids cannot create ambiguous digests. */
export function shadowContentDigest(rows: ReadonlyArray<{ id: string; hash: string }>): string {
  const digest = createHash("sha256");
  for (const row of rows) digest.update(JSON.stringify([row.id, row.hash]) + "\n");
  return digest.digest("hex");
}
function planIdentity(plan: ShadowPlan, models: readonly string[]): string {
  return sha(JSON.stringify([plan.runId, plan.snapshotId, plan.sourceConsistency, plan.targetDatabase,
    models.map(model => [model, plan.expected[model].count, plan.expected[model].digest])]));
}

/**
 * No runtime DB connection, source writes, live synchronization, or cutover authorization.
 * Adapters are trusted capabilities: target must enforce insert-only access and prohibit
 * other writers for this namespace. A databaseName string is not connection authorization.
 * Codec must deterministically preserve authenticated encrypted snapshot documents;
 * randomized plaintext encryption belongs in a prior immutable export, not each retry.
 * Reference verification must cover every relation/model in that exact snapshot.
 */
export async function transferMongoShadow(
  plan: ShadowPlan, source: ShadowSource, target: ShadowTarget, codec: ShadowCodec,
  verifyReferences: (context: { namespace: string; snapshotId: string; target: ShadowTarget }) => Promise<{ verified: true; evidenceId: string }>,
) {
  const models = [...codec.models].sort();
  const batch = plan.batchSize ?? 100;
  const maxRows = plan.maxRows ?? 1_000_000;
  check(/^[a-zA-Z0-9_-]{1,80}$/.test(plan.runId), "RUN_ID");
  check(typeof plan.snapshotId === "string" && plan.snapshotId.length > 0, "SNAPSHOT_REQUIRED");
  check(["exported-snapshot", "frozen-source"].includes(plan.sourceConsistency), "CONSISTENCY_REQUIRED");
  check(plan.allowShadowWrites === true && plan.targetDatabase === target.databaseName &&
    !!plan.targetDatabase && !!plan.productionDatabase && plan.targetDatabase.toLowerCase() !== plan.productionDatabase.toLowerCase(), "SHADOW_WRITE_GATE");
  check(Number.isSafeInteger(batch) && batch > 0 && batch <= 1000 && Number.isSafeInteger(maxRows) && maxRows > 0, "BOUNDS");
  check(models.length > 0 && new Set(models).size === models.length && !models.includes("__run") &&
    JSON.stringify(Object.keys(plan.expected).sort()) === JSON.stringify(models), "MODEL_COVERAGE");
  let plannedRows = 0;
  for (const model of models) {
    const expected = plan.expected[model];
    check(Number.isSafeInteger(expected.count) && expected.count >= 0 && /^[a-f0-9]{64}$/.test(expected.digest), "MANIFEST");
    plannedRows += expected.count;
  }
  check(Number.isSafeInteger(plannedRows) && plannedRows <= maxRows, "ROW_LIMIT");
  const namespace = `shadow_${plan.runId}`;
  const identity = planIdentity(plan, models);
  await source.assertSnapshot(plan.snapshotId);
  await target.insertOnly(namespace, "__run", { _id: "manifest", identity });
  const saved = await target.get(namespace, "__run", "manifest");
  check(saved && Object.keys(saved).length === 2 && saved.identity === identity, "RUN_REUSE_MISMATCH");
  const counts: Record<string, number> = {};
  for (const model of models) {
    let after: string | null = null;
    let count = 0;
    const digest = createHash("sha256");
    while (true) {
      await source.assertSnapshot(plan.snapshotId);
      const rows = await source.page(plan.snapshotId, model, after, batch);
      await source.assertSnapshot(plan.snapshotId);
      check(Array.isArray(rows) && rows.length <= batch, "SOURCE_PAGE");
      if (!rows.length) break;
      for (const row of rows) {
        const document = codec.encode(model, row);
        check(typeof document._id === "string" && document._id.length > 0 && (after === null || document._id > after), "SOURCE_ORDER");
        check(++count <= plan.expected[model].count, "SOURCE_COUNT");
        const hash = codec.hash(model, document);
        check(/^[a-f0-9]{64}$/.test(hash), "CODEC_HASH");
        await target.insertOnly(namespace, model, document);
        const readback = await target.get(namespace, model, document._id);
        check(readback && readback._id === document._id && codec.hash(model, readback) === hash, "TARGET_READBACK");
        digest.update(JSON.stringify([document._id, hash]) + "\n");
        after = document._id;
      }
    }
    check(count === plan.expected[model].count && digest.digest("hex") === plan.expected[model].digest, "SOURCE_MANIFEST_MISMATCH");
    counts[model] = count;
  }
  await source.assertSnapshot(plan.snapshotId);
  // Independently page the destination: get() alone would miss unrelated extra rows.
  for (const model of models) {
    check(await target.count(namespace, model) === counts[model], "TARGET_COUNT");
    let after: string | null = null;
    let count = 0;
    const digest = createHash("sha256");
    while (true) {
      const rows = await target.page(namespace, model, after, batch);
      check(Array.isArray(rows) && rows.length <= batch, "TARGET_PAGE");
      if (!rows.length) break;
      for (const row of rows) {
        check(typeof row._id === "string" && (after === null || row._id > after), "TARGET_ORDER");
        check(++count <= counts[model], "TARGET_COUNT");
        const hash = codec.hash(model, row);
        check(/^[a-f0-9]{64}$/.test(hash), "CODEC_HASH");
        digest.update(JSON.stringify([row._id, hash]) + "\n");
        after = row._id;
      }
    }
    check(count === counts[model] && digest.digest("hex") === plan.expected[model].digest, "TARGET_MANIFEST_MISMATCH");
  }
  const references = await verifyReferences({ namespace, snapshotId: plan.snapshotId, target });
  check(references?.verified === true && typeof references.evidenceId === "string" && references.evidenceId.length > 0, "REFERENCE_GATE");
  await source.assertSnapshot(plan.snapshotId);
  return { status: "shadow-verified" as const, namespace, counts, referencesVerified: true as const,
    cutoverAuthorized: false as const, liveChangesSynchronized: false as const,
    finalFrozenRunRequired: plan.sourceConsistency !== "frozen-source" };
}
