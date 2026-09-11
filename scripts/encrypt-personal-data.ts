/** Read-only by default. Never print values, identifiers, keys, or database errors. */
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertPrivacyConfiguration } from "../src/lib/privacy/crypto";
import { decryptField, encryptField, indexField, privacyFields, storedEncrypted } from "../src/lib/privacy/fields";

const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
export async function migratePersonalData(db: PrismaClient, apply: boolean) {
  const counts: Record<string, { rows: number; plaintext: number; encrypted: number; invalidIndexes: number }> = {};
  for (const [model, definition] of Object.entries(privacyFields)) {
    const idColumn = definition.primaryKey;
    const table = quote(definition.table);
    const jsonPresence = Object.values(definition.fields).filter(p => p.type === "Json").map(p => `(${quote(p.column)} IS NOT NULL) AS ${quote("__pii_present_" + p.column)}`);
    const projection = ["*", ...jsonPresence].join(", ");
    let cursor = "";
    const count = counts[definition.table] = { rows: 0, plaintext: 0, encrypted: 0, invalidIndexes: 0 };
    while (true) {
      const processed = await db.$transaction(async tx => {
        if (!apply) await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT ${projection} FROM ${table} WHERE ${quote(idColumn)}::text > $1 ORDER BY ${quote(idColumn)}::text LIMIT 200${apply ? ' FOR UPDATE' : ''}`, cursor);
        for (const row of rows) {
          const patch: Record<string, unknown> = {};
          for (const [field, policy] of Object.entries(definition.fields)) {
            const storageColumn = policy.storageColumn ?? policy.column;
            const stored = row[storageColumn];
            const legacy = row[policy.column];
            if (policy.storageColumn && stored != null && legacy != null) throw new Error("Conflicting encrypted and plaintext date values; review before migration.");
            let plain: unknown;
            const encrypted = stored != null && storedEncrypted(policy, stored);
            if (encrypted) {
              plain = decryptField(model, field, stored);
              count.encrypted++;
            } else {
              plain = legacy === null && policy.type === "Json" && row["__pii_present_" + policy.column] ? Prisma.JsonNull : legacy;
              if (plain == null) {
                if (policy.indexColumn && row[policy.indexColumn] != null) { patch[policy.indexColumn] = null; count.invalidIndexes++; }
                continue;
              }
              count.plaintext++;
              patch[storageColumn] = encryptField(model, field, plain);
              if (policy.storageColumn) patch[policy.column] = null;
            }
            if (policy.indexColumn) {
              const expected = indexField(model, field, plain);
              if (row[policy.indexColumn] !== expected) { patch[policy.indexColumn] = expected; count.invalidIndexes++; }
            }
          }
          if (apply && Object.keys(patch).length) {
            const fields = Object.keys(patch);
            // Prisma raw parameters support JSON via an explicit JSON text cast.
            const values = fields.map(column => {
              const value = patch[column];
              return value && typeof value === "object" && !(value instanceof Uint8Array) ? JSON.stringify(value) : value;
            });
            const jsonColumns = new Set(Object.values(definition.fields).filter(p => p.type === "Json").map(p => p.column));
            const set = fields.map((column, i) => `${quote(column)} = $${i + 1}${jsonColumns.has(column) ? '::jsonb' : ''}`).join(', ');
            await tx.$executeRawUnsafe(`UPDATE ${table} SET ${set} WHERE ${quote(idColumn)}::text = $${values.length + 1}`, ...values, String(row[idColumn]));
          }
          count.rows++;
          cursor = String(row[idColumn]);
        }
        return rows.length;
      }, { timeout: 30_000 });
      if (processed < 200) break;
    }
  }
  return counts;
}

export async function enforcePersonalData(db: PrismaClient) {
  // A complete validation pass authenticates every encrypted value before adding guards.
  const counts = await migratePersonalData(db, false);
  if (Object.values(counts).some(c => c.plaintext || c.invalidIndexes)) throw new Error("Plaintext remains; run the backfill first.");
  await db.$transaction(async tx => {
    for (const definition of Object.values(privacyFields)) {
      const checks: string[] = [];
      for (const policy of Object.values(definition.fields)) {
        if (policy.allowAuditMetadata) continue; // New trigger writes only reviewed, redacted diffs.
        const column = quote(policy.storageColumn ?? policy.column);
        const expression = policy.type === "Json" ? `${column}->>'__pii'` : policy.type === "Bytes" ? `convert_from(${column}, 'UTF8')` : column;
        checks.push(`(${column} IS NULL OR coalesce(${expression} ~ '^pii:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$', false))`);
        if (policy.storageColumn) checks.push(`${quote(policy.column)} IS NULL`);
        if (policy.indexColumn) checks.push(`((${column} IS NULL AND ${quote(policy.indexColumn)} IS NULL) OR (${column} IS NOT NULL AND coalesce(${quote(policy.indexColumn)} ~ '^[0-9a-f]{64}$', false)))`);
      }
      const table = quote(definition.table);
      await tx.$executeRawUnsafe(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS pii_encrypted_storage`);
      await tx.$executeRawUnsafe(`ALTER TABLE ${table} ADD CONSTRAINT pii_encrypted_storage CHECK (${checks.join(' AND ')})`);
    }
  }, { timeout: 60_000 });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const enforce = args.has("--enforce");
  if ([...args].some(a => !["--apply", "--enforce", "--backup-confirmed", "--maintenance-confirmed"].includes(a))) throw new Error("Unknown migration argument.");
  if ((apply || enforce) && !(args.has("--backup-confirmed") && args.has("--maintenance-confirmed"))) throw new Error("Writes require --backup-confirmed and --maintenance-confirmed.");
  assertPrivacyConfiguration();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, options: "-c timezone=UTC" }) });
  try {
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", tables: await migratePersonalData(db, apply) }));
    if (enforce) { await enforcePersonalData(db); console.log("Encrypted storage constraints verified."); }
  } finally { await db.$disconnect(); }
}
if (process.argv[1]?.endsWith("encrypt-personal-data.ts")) main().catch(() => { console.error("PII migration failed. No data values are logged. Check configuration, backup, maintenance and schema state."); process.exitCode = 1; });
