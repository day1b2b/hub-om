/** Explicit offline export tool. Never imports dotenv or changes application DB routing. */
import path from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { encodeMongoDocument, hashMongoDocument, mongoModelNames, type CanonicalDocument } from "../src/lib/migration/mongoDocumentCodec";
import { indexField, privacyFields } from "../src/lib/privacy/fields";
import { createPostgresShadowSnapshot } from "../src/lib/migration/postgresShadowSource";
import { exportPostgresShadow, newShadowExportDirectory } from "../src/lib/migration/postgresShadowExport";

type ShadowExportArguments = {
  outputParent: string;
  sourceMode: "plaintext" | "encrypted";
  recomputePlaintextDerivedIndexes: boolean;
};

export function parseShadowExportArguments(args: string[]): ShadowExportArguments {
  const allowed = new Set(["--allow-read-only-source-export", "--output-parent", "--source-mode", "--recompute-plaintext-derived-indexes"]);
  const values = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag) || values.has(flag)) throw new Error("EXPORT_ARGUMENTS");
    if (flag === "--allow-read-only-source-export" || flag === "--recompute-plaintext-derived-indexes") values.set(flag, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("EXPORT_ARGUMENTS");
      values.set(flag, value);
    }
  }
  const outputParent = values.get("--output-parent");
  const sourceMode = values.get("--source-mode");
  const recomputePlaintextDerivedIndexes = values.get("--recompute-plaintext-derived-indexes") === true;
  if (values.get("--allow-read-only-source-export") !== true || typeof outputParent !== "string" || !path.isAbsolute(outputParent) ||
      (sourceMode !== "plaintext" && sourceMode !== "encrypted") || (recomputePlaintextDerivedIndexes && sourceMode !== "plaintext")) throw new Error("EXPORT_ARGUMENTS");
  return { outputParent, sourceMode, recomputePlaintextDerivedIndexes };
}

/**
 * Replaces only stale, non-null HMAC companions in an in-memory plaintext export row.
 * The source row and PostgreSQL are never changed. Returning null delegates the final
 * calculation and validation to the existing fail-closed document codec.
 */
export function normalizePlaintextDerivedIndexesForExport(model: string, row: Record<string, unknown>) {
  const normalized = { ...row };
  let recomputed = 0;
  for (const [field, policy] of Object.entries(privacyFields[model]?.fields ?? {})) {
    if (!policy.index) continue;
    const current = row[policy.index];
    const expected = indexField(model, field, row[field]);
    if (current != null && current !== expected) {
      normalized[policy.index] = null;
      recomputed++;
    }
  }
  return { row: normalized, recomputed };
}

export async function runShadowExport(args: string[]) {
  const options = parseShadowExportArguments(args);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("EXPORT_DATABASE_REQUIRED");
  const parsed = new URL(databaseUrl);
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) throw new Error("EXPORT_DATABASE_REQUIRED");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    let recomputedDerivedIndexes = 0;
    const snapshot = await createPostgresShadowSnapshot(pool);
    const result = await exportPostgresShadow({ directory: newShadowExportDirectory(options.outputParent),
      sourceMode: options.sourceMode, snapshot,
      codec: { models: mongoModelNames,
        encode: (model, row, sourceMode) => {
          if (!options.recomputePlaintextDerivedIndexes) return encodeMongoDocument(model, row, { sourceMode });
          const normalized = normalizePlaintextDerivedIndexesForExport(model, row);
          recomputedDerivedIndexes += normalized.recomputed;
          return encodeMongoDocument(model, normalized.row, { sourceMode });
        },
        hash: (model, document) => hashMongoDocument(model, document as CanonicalDocument) } });
    // Location is generated locally; no URI, source values, row ids, or key material printed.
    process.stdout.write(JSON.stringify({ status: "encrypted-export-complete", directory: result.directory,
      modelCount: Object.keys(result.manifest.models).length,
      rowCount: Object.values(result.manifest.models).reduce((sum, model) => sum + model.count, 0),
      recomputedDerivedIndexes,
      cutoverAuthorized: false, sequenceValuesRequireFrozenRecheck: true }) + "\n");
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runShadowExport(process.argv.slice(2)).catch(() => {
    process.stderr.write("MongoDB 검증용 내보내기에 실패했습니다. 원본 DB는 수정하지 않았습니다. 미완료 폴더를 재사용하지 마세요.\n");
    process.exitCode = 1;
  });
}
