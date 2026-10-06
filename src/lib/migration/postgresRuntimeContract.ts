export const POSTGRES_RUNTIME_ORDER_PROBE = [
  "A", "a", "Z", "z", "~", "é", "e\u0301", "가", "나", "힣",
] as const;

export interface PostgresRuntimeQueryResult<Row> {
  rows: Row[];
}

export interface PostgresRuntimeClient {
  connect(): Promise<unknown>;
  query<Row extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<PostgresRuntimeQueryResult<Row>>;
  end(): Promise<unknown>;
  destroy(): Promise<unknown> | void;
  on(event: "error", listener: (error: unknown) => void): unknown;
  off(event: "error", listener: (error: unknown) => void): unknown;
}

interface RuntimeMetadataRow extends Record<string, unknown> {
  session_timezone: unknown;
  encoding: unknown;
  collate: unknown;
  ctype: unknown;
  provider: unknown;
  recorded_collation_version: unknown;
  actual_collation_version: unknown;
}

interface RuntimeOrderRow extends Record<string, unknown> {
  value: unknown;
}

export interface PostgresRuntimeContractReport {
  status: "compatible" | "blocked";
  checks: {
    utcSession: boolean;
    utf8Encoding: boolean;
    byteProbeOrdering: boolean;
    verifiedByteCollation: boolean;
    collationVersionCurrent: boolean;
  };
  metadata: {
    sessionTimezone: string;
    encoding: string;
    collate: string;
    ctype: string;
    provider: string;
    recordedCollationVersion: string | null;
    actualCollationVersion: string | null;
  };
}

const METADATA_SQL = `
SELECT
  current_setting('TimeZone') AS session_timezone,
  pg_encoding_to_char(d.encoding) AS encoding,
  d.datcollate AS collate,
  d.datctype AS ctype,
  COALESCE(to_jsonb(d)->>'datlocprovider', 'unknown') AS provider,
  d.datcollversion AS recorded_collation_version,
  pg_database_collation_actual_version(d.oid) AS actual_collation_version
FROM pg_database AS d
WHERE d.datname = current_database()
`;

const ORDER_SQL = `
SELECT value
FROM unnest($1::text[]) WITH ORDINALITY AS probe(value, position)
ORDER BY value ASC, position ASC
`;

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function byteOrder(values: readonly string[]): string[] {
  return [...values].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
}

/**
 * Reads only database/session metadata and fixed synthetic strings. It never reads an
 * application table. The caller must also make the connection read-only so the gate
 * remains safe before BEGIN is reached.
 */
export async function inspectPostgresRuntimeContract(
  client: PostgresRuntimeClient,
  options: { cleanupTimeoutMs?: number } = {},
): Promise<PostgresRuntimeContractReport> {
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 5000) {
    throw new Error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");
  }
  let connectAttempted = false, cleanupConfirmed = false, transaction = false, failed = false, asynchronousError = false;
  let report: PostgresRuntimeContractReport | undefined;
  const onError = () => { asynchronousError = true; };
  client.on("error", onError);
  try {
    connectAttempted = true;
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    transaction = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");

    const metadataResult = await client.query<RuntimeMetadataRow>(METADATA_SQL);
    if (metadataResult.rows.length !== 1) throw new Error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");
    const row = metadataResult.rows[0];
    const metadata = {
      sessionTimezone: requiredString(row.session_timezone),
      encoding: requiredString(row.encoding),
      collate: requiredString(row.collate),
      ctype: requiredString(row.ctype),
      provider: requiredString(row.provider),
      recordedCollationVersion: optionalString(row.recorded_collation_version),
      actualCollationVersion: optionalString(row.actual_collation_version),
    };

    const orderedResult = await client.query<RuntimeOrderRow>(ORDER_SQL, [[...POSTGRES_RUNTIME_ORDER_PROBE]]);
    const actualOrder = orderedResult.rows.map(({ value }) => requiredString(value));
    const expectedOrder = byteOrder(POSTGRES_RUNTIME_ORDER_PROBE);
    const byteProbeOrdering = actualOrder.length === expectedOrder.length
      && actualOrder.every((value, index) => value === expectedOrder[index]);
    const verifiedByteCollation = metadata.provider === "c"
      && (metadata.collate === "C" || metadata.collate === "POSIX")
      && (metadata.ctype === "C" || metadata.ctype === "POSIX")
      && byteProbeOrdering;
    const checks = {
      utcSession: metadata.sessionTimezone.toUpperCase() === "UTC",
      utf8Encoding: metadata.encoding.toUpperCase() === "UTF8",
      byteProbeOrdering,
      verifiedByteCollation,
      collationVersionCurrent: metadata.recordedCollationVersion === metadata.actualCollationVersion,
    };
    await client.query("ROLLBACK");
    transaction = false;
    report = {
      status: Object.values(checks).every(Boolean) ? "compatible" : "blocked",
      checks,
      metadata,
    };
  } catch {
    failed = true;
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch { /* Keep the public failure generic. */ }
      transaction = false;
    }
  } finally {
    if (connectAttempted) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.end(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED")), cleanupTimeoutMs);
          }),
        ]);
        cleanupConfirmed = true;
      } catch {
        failed = true;
        let destroyTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.resolve(client.destroy()),
            new Promise<never>((_, reject) => {
              destroyTimer = setTimeout(() => reject(new Error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED")), cleanupTimeoutMs);
            }),
          ]);
          cleanupConfirmed = true;
        } catch { /* The command already fails generically. */ }
        finally { if (destroyTimer) clearTimeout(destroyTimer); }
      }
      finally { if (timer) clearTimeout(timer); }
    }
    // A listener retained on an unconfirmed connection is intentional: a late
    // driver event must stay generic instead of becoming an unhandled error.
    if (!connectAttempted || cleanupConfirmed) client.off("error", onError);
  }
  if (failed || asynchronousError || !report) throw new Error("POSTGRES_RUNTIME_CONTRACT_CHECK_FAILED");
  return report;
}
