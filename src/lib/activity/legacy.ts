import type { Prisma } from "@prisma/client";
import { activityQuery } from "./query";

export function legacyAction(content: string) { return content.startsWith("메모 작성:") ? "create" : /^(메모 삭제:|리뷰 삭제)/.test(content) ? "delete" : "update"; }
export function legacyWhere(params: URLSearchParams): Prisma.CoachContentEntryWhereInput | null {
  const parsed = activityQuery(params);
  if (params.get("requestId") || (params.get("actorType") && params.get("actorType") !== "user") || (params.get("targetType") && params.get("targetType") !== "coaches") || params.get("action") === "restore") return null;
  const where: Prisma.CoachContentEntryWhereInput = { kind: "EDIT_HISTORY", createdAt: parsed.changes.occurredAt as Prisma.DateTimeFilter };
  if (params.get("email")) where.authorEmail = { contains: params.get("email")!.trim().slice(0, 254), mode: "insensitive" };
  if (params.get("targetId")) {
    const id = params.get("targetId")!;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    where.coachId = id;
  }
  const creation = { content: { startsWith: "메모 작성:" } };
  const deletion = { OR: [{ content: { startsWith: "메모 삭제:" } }, { content: { startsWith: "리뷰 삭제" } }] };
  if (params.get("action") === "create") where.AND = [creation];
  if (params.get("action") === "delete") where.AND = [deletion];
  if (params.get("action") === "update") where.NOT = [creation, deletion];
  const cursor = params.get("cursor");
  if (cursor) {
    const [stamp, id] = cursor.split("|");
    const createdAt = new Date(stamp);
    const prior = Array.isArray(where.AND) ? where.AND : [];
    where.AND = [...prior, { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
  }
  return where;
}
