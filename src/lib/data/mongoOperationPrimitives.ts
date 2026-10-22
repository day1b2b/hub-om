export class MongoOperationError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Mongo operation failed: ${code}`); this.code = code; }
}

export function assertMongo(condition: unknown, code: string): asserts condition {
  if (!condition) throw new MongoOperationError(code);
}

/** Log-safe failure code. MongoOperationError messages carry a prose prefix, so read the fixed code instead. */
export function mongoFailureCode(error: unknown): string {
  const code = error instanceof MongoOperationError ? error.code : error instanceof Error ? error.message : "";
  return /^[A-Z0-9_:\- ]{1,160}$/.test(code) ? code : "REDACTED";
}

export function stableMongoValue(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableMongoValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableMongoValue(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
