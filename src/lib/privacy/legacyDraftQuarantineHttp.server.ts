import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { LEGACY_DRAFT_MAX_REQUEST_BYTES } from "./legacyDraftQuarantine";
import { QuarantineInputError, QuarantineVerificationError, sealLegacyDraftQuarantine, verifyLegacyDraftQuarantine } from "./legacyDraftQuarantine.server";

const HEADERS = {
  "Cache-Control": "no-store, private, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Vary": "Cookie, Origin",
  "X-Content-Type-Options": "nosniff",
};
export function quarantineReply(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: HEADERS });
}
function trustedOrigin(request: Request): string {
  const dedicated = process.env.BROWSER_DRAFT_APP_ORIGIN?.trim();
  const canonical = dedicated || process.env.AUTH_URL?.trim();
  if (!canonical && process.env.NODE_ENV === "production") throw new Error("Trusted origin unavailable.");
  const parsed = new URL(canonical || request.url);
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password
    || (canonical && (parsed.search || parsed.hash))
    || (dedicated && parsed.pathname !== "/")
    || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
    throw new Error("Trusted origin unavailable.");
  }
  return parsed.origin;
}
function sameOrigin(request: Request): boolean {
  // Configuration failure must return 503, separately from a rejected Origin.
  const expected = trustedOrigin(request);
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin === "null") return false;
    const parsed = new URL(origin);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.origin !== origin) return false;
    // Neither the internal standalone URL nor X-Forwarded-* selects the
    // production origin. Only explicit deployment configuration is trusted.
    if (parsed.origin !== expected) return false;
    const site = request.headers.get("sec-fetch-site");
    return site === null || site === "same-origin";
  } catch { return false; }
}


class BodyLimitError extends Error {}
async function boundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > LEGACY_DRAFT_MAX_REQUEST_BYTES)) throw new BodyLimitError();
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new QuarantineInputError();
  if (!request.body) throw new QuarantineInputError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LEGACY_DRAFT_MAX_REQUEST_BYTES) { await reader.cancel(); throw new BodyLimitError(); }
      chunks.push(value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new QuarantineInputError(); }
  } finally { reader.releaseLock(); }
}
/** No activity wrapper, payload logging, database writes, or plaintext responses. */
export async function quarantinePost(request: Request, action: "seal" | "verify"): Promise<Response> {
  try {
    if (!sameOrigin(request)) return quarantineReply({ error: "forbidden_origin" }, 403);
    const session = await auth();
    if (!session?.user?.email || !isAllowedWorkspaceEmail(session.user.email)) return quarantineReply({ error: "unauthorized" }, 401);
    const subject = (session as { browserDraftSubject?: unknown }).browserDraftSubject;
    if (typeof subject !== "string" || !subject) return quarantineReply({ error: "reauthentication_required" }, 409);
    const body = await boundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).sort().join() !== (action === "seal" ? "snapshot" : "record,snapshot")) throw new QuarantineInputError();
    const input = body as { snapshot: unknown; record?: unknown };
    return quarantineReply(action === "seal" ? { record: sealLegacyDraftQuarantine(input.snapshot, subject) }
      : verifyLegacyDraftQuarantine(input.record, input.snapshot, subject), 200);
  } catch (error) {
    if (error instanceof BodyLimitError) return quarantineReply({ error: "request_too_large" }, 413);
    if (error instanceof QuarantineInputError) return quarantineReply({ error: "invalid_request" }, 400);
    if (error instanceof QuarantineVerificationError) return quarantineReply({ error: "verification_failed" }, 409);
    return quarantineReply({ error: "quarantine_unavailable" }, 503);
  }
}
