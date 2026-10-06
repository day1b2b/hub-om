export type SafeErrorDiagnostic = Readonly<{
  name: string;
  code?: string | number;
  messageCode?: string;
}>;

const safeName = /^[A-Za-z][A-Za-z0-9]{0,63}Error$/;
const safeCode = /^[A-Z][A-Z0-9_:-]{0,99}$/;

/**
 * Keep enough failure classification for production diagnosis without logging
 * exception messages, stacks, request values, database URLs, or private data.
 */
export function safeErrorDiagnostic(error: unknown): SafeErrorDiagnostic {
  if (!error || typeof error !== "object") return Object.freeze({ name: "NonError" });
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof candidate.name === "string" && safeName.test(candidate.name)
    ? candidate.name
    : "Error";
  const result: { name: string; code?: string | number; messageCode?: string } = { name };
  if (typeof candidate.code === "string" && safeCode.test(candidate.code)) result.code = candidate.code;
  else if (typeof candidate.code === "number" && Number.isSafeInteger(candidate.code)) result.code = candidate.code;
  if (typeof candidate.message === "string" && safeCode.test(candidate.message)) result.messageCode = candidate.message;
  return Object.freeze(result);
}
