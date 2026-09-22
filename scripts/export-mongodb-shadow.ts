/** Explicit offline export tool. Never imports dotenv or changes application DB routing. */
import path from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { encodeMongoDocument, hashMongoDocument, mongoModelNames, type CanonicalDocument } from "../src/lib/migration/mongoDocumentCodec";
import { createPostgresShadowSnapshot } from "../src/lib/migration/postgresShadowSource";
import { exportPostgresShadow, newShadowExportDirectory } from "../src/lib/migration/postgresShadowExport";

export function parseShadowExportArguments(args: string[]): { outputParent: string; sourceMode: "plaintext" | "encrypted" } {
  const allowed = new Set(["--allow-read-only-source-export", "--output-parent", "--source-mode"]);
  const values = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag) || values.has(flag)) throw new Error("EXPORT_ARGUMENTS");
    if (flag === "--allow-read-only-source-export") values.set(flag, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("EXPORT_ARGUMENTS");
      values.set(flag, value);
    }
  }
  const outputParent = values.get("--output-parent");
  const sourceMode = values.get("--source-mode");
  if (values.get("--allow-read-only-source-export") !== true || typeof outputParent !== "string" || !path.isAbsolute(outputParent) ||
      (sourceMode !== "plaintext" && sourceMode !== "encrypted")) throw new Error("EXPORT_ARGUMENTS");
  return { outputParent, sourceMode };
}

export async function runShadowExport(args: string[]) {
  const options = parseShadowExportArguments(args);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("EXPORT_DATABASE_REQUIRED");
  const parsed = new URL(databaseUrl);
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) throw new Error("EXPORT_DATABASE_REQUIRED");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const snapshot = await createPostgresShadowSnapshot(pool);
    const result = await exportPostgresShadow({ directory: newShadowExportDirectory(options.outputParent),
      sourceMode: options.sourceMode, snapshot,
      codec: { models: mongoModelNames,
        encode: (model, row, sourceMode) => encodeMongoDocument(model, row, { sourceMode }),
        hash: (model, document) => hashMongoDocument(model, document as CanonicalDocument) } });
    // Location is generated locally; no URI, source values, row ids, or key material printed.
    process.stdout.write(JSON.stringify({ status: "encrypted-export-complete", directory: result.directory,
      modelCount: Object.keys(result.manifest.models).length,
      rowCount: Object.values(result.manifest.models).reduce((sum, model) => sum + model.count, 0),
      cutoverAuthorized: false, sequenceValuesRequireFrozenRecheck: true }) + "\n");
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runShadowExport(process.argv.slice(2)).catch(() => {
    process.stderr.write("MongoDB 검증용 내보내기에 실패했습니다. 원본 DB는 수정하지 않았습니다. 미완료 폴더를 재사용하지 마세요.\n");
    process.exitCode = 1;
  });
}
