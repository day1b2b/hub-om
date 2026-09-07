import type { Prisma } from "@prisma/client";

const actions = new Set(["create", "update", "delete", "restore"]);
const actorTypes = new Set(["user", "token_request", "anonymous", "development"]);

export function activityQuery(params: URLSearchParams) {
  const tab = params.get("tab") === "requests" ? "requests" : "changes";
  const email = params.get("email")?.trim().slice(0, 254);
  const actorType = params.get("actorType");
  if (actorType && !actorTypes.has(actorType)) throw new Error("실행 주체를 확인하세요.");
  function boundary(key: string, nextDay: boolean) {
    const value = params.get(key);
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("날짜 형식을 확인하세요.");
    const date = new Date(`${value}T00:00:00+09:00`);
    if (Number.isNaN(date.getTime()) || new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10) !== value) throw new Error("유효한 날짜를 입력하세요.");
    return new Date(date.getTime() + (nextDay ? 86400000 : 0));
  }
  const from = boundary("from", false);
  const until = boundary("until", true);
  if (from && until && from >= until) throw new Error("조회 기간을 확인하세요.");
  const base = {
    ...(email ? { actorEmail: { contains: email, mode: "insensitive" as const } } : {}),
    ...(actorType ? { actorType } : {}),
    occurredAt: { ...(from ? { gte: from } : {}), ...(until ? { lt: until } : {}) }
  };
  const requestId = params.get("requestId");
  if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("요청 ID를 확인하세요.");
  const action = params.get("action");
  if (action && !actions.has(action)) throw new Error("작업 종류를 확인하세요.");
  const targetType = params.get("targetType")?.slice(0, 100);
  const targetId = params.get("targetId")?.slice(0, 300);
  const route = params.get("route")?.slice(0, 200);
  const changes: Prisma.ActivityChangeWhereInput = {
    ...base, ...(action ? { action } : {}), ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}), ...(requestId ? { requestId } : {})
  };
  const requests: Prisma.ActivityRequestWhereInput = {
    ...base, ...(requestId ? { id: requestId } : {}), ...(route ? { route: { contains: route } } : {}),
    ...(params.get("errors") === "true" ? { status: { gte: 400 } } : {})
  };
  const cursorValue = params.get("cursor");
  if (cursorValue) {
    const separator = cursorValue.indexOf("|");
    const occurredAt = new Date(cursorValue.slice(0, separator));
    const id = cursorValue.slice(separator + 1);
    if (separator < 0 || Number.isNaN(occurredAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("페이지 위치가 유효하지 않습니다.");
    const cursorFilter = { OR: [{ occurredAt: { lt: occurredAt } }, { occurredAt, id: { lt: id } }] };
    changes.AND = [cursorFilter];
    requests.AND = [cursorFilter];
  }
  return { tab, changes, requests };
}
