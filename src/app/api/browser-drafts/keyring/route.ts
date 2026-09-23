import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { deriveBrowserDraftKeyring } from "@/lib/privacy/browserDraftKeyring.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = {
  "Cache-Control": "no-store, private, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Vary": "Cookie, Origin",
  "X-Content-Type-Options": "nosniff",
};
function reply(value: unknown, status: number): Response {
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

/** Deliberately excludes activity wrappers: key responses must not enter audit logs. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!sameOrigin(request)) return reply({ error: "forbidden_origin" }, 403);
    // Do not use the development bypass/redirecting requireWorkspaceSession helper.
    const session = await auth();
    if (!session?.user?.email || !isAllowedWorkspaceEmail(session.user.email)) return reply({ error: "unauthorized" }, 401);
    const subject = (session as { browserDraftSubject?: unknown }).browserDraftSubject;
    if (typeof subject !== "string" || !subject) return reply({ error: "reauthentication_required" }, 409);
    // No request body/query is consumed. Every key belongs to the current session.
    return reply(deriveBrowserDraftKeyring(subject), 200);
  } catch {
    // Never include auth exceptions, configuration, identity or key material.
    return reply({ error: "draft_keys_unavailable" }, 503);
  }
}
