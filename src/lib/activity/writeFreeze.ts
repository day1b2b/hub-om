/**
 * Cutover write freeze. HUB_WRITE_FREEZE=true rejects every save before any business side effect,
 * so a final copy can capture all data. Coach token routes are blocked for reads too because
 * their GET handlers write access logs.
 */
export function isWriteFreezeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HUB_WRITE_FREEZE === "true";
}

export function isFrozenRequest(route: string, method: string): boolean {
  const verb = method.toUpperCase();
  return (verb !== "GET" && verb !== "HEAD") || route.startsWith("/api/coach/");
}

export function writeFreezeResponse(): Response {
  return Response.json(
    { error: "시스템 점검 중이라 지금은 저장할 수 없습니다. 점검이 끝난 뒤 다시 시도해 주세요.", code: "WRITE_FREEZE" },
    { status: 503, headers: { "Retry-After": "600", "Cache-Control": "no-store" } },
  );
}
