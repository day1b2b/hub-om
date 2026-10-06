/** No key import and no storage. A transport/server failure must not be mistaken for logout. */
export async function checkDraftSession(subject: string | null, request: typeof fetch = fetch): Promise<"same" | "denied" | "changed" | "unavailable"> {
  try {
    const response = await request("/api/browser-drafts/keyring", { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (response.status === 401 || response.status === 409) return "denied";
    if (!response.ok) return "unavailable";
    const body = await response.json() as { subject?: unknown };
    return typeof body.subject === "string" && body.subject === subject ? "same" : "changed";
  } catch { return "unavailable"; }
}
