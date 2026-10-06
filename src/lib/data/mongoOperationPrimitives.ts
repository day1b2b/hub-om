export class MongoOperationError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Mongo operation failed: ${code}`); this.code = code; }
}

export function assertMongo(condition: unknown, code: string): asserts condition {
  if (!condition) throw new MongoOperationError(code);
}

export function stableMongoValue(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableMongoValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableMongoValue(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
