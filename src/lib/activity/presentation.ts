import type { ActivityChange, PrismaClient } from "@prisma/client";
type Change = { before?: unknown; after?: unknown; redacted?: boolean };
export function changedText(changes: unknown, field: string) {
  const change = (changes as Record<string, Change>)?.[field];
  if (!change || change.redacted) return undefined;
  const value = change.after ?? change.before;
  return typeof value === "string" ? value : undefined;
}
export async function describeChanges(db: PrismaClient, rows: ActivityChange[]) {
  const ids = (kind: string) => rows.filter(r => r.targetType === kind && /^[0-9a-f-]{36}$/i.test(r.targetId)).map(r => r.targetId);
  const operationIds = rows.flatMap(r => r.targetType === "calendar_event_links" ? [changedText(r.changes, "operation_id")].filter((v): v is string => Boolean(v)) : []);
  const [operations, coaches, courses, companies, notes, engagements] = await Promise.all([
    db.operationSession.findMany({ where: { OR: [{ id: { in: ids("operation_sessions") } }, { operationId: { in: operationIds } }] }, select: { id: true, operationId: true, roundNo: true, course: { select: { name: true, company: { select: { name: true } } } } } }),
    db.coach.findMany({ where: { id: { in: ids("coaches") } }, select: { id: true, name: true, deletedAt: true } }),
    db.course.findMany({ where: { id: { in: ids("courses") } }, select: { id: true, name: true, company: { select: { name: true } } } }),
    db.company.findMany({ where: { id: { in: ids("companies") } }, select: { id: true, name: true } }),
    db.coachContentEntry.findMany({ where: { id: { in: ids("coach_content_entries") } }, select: { id: true, coach: { select: { id: true, name: true, deletedAt: true } } } }),
    db.coachEngagement.findMany({ where: { id: { in: ids("coach_engagements") } }, select: { id: true, coach: { select: { id: true, name: true, deletedAt: true } } } })
  ]);
  return rows.map(row => {
    const op = operations.find(o => row.targetType === "operation_sessions" ? o.id === row.targetId : row.targetType === "calendar_event_links" && o.operationId === changedText(row.changes, "operation_id"));
    const coach = row.targetType === "coaches" ? coaches.find(c => c.id === row.targetId)
      : row.targetType === "coach_content_entries" ? notes.find(n => n.id === row.targetId)?.coach
      : row.targetType === "coach_engagements" ? engagements.find(e => e.id === row.targetId)?.coach : undefined;
    const course = row.targetType === "courses" ? courses.find(c => c.id === row.targetId) : undefined;
    const company = row.targetType === "companies" ? companies.find(c => c.id === row.targetId) : undefined;
    const targetLabel = op ? `${op.course.company.name} · ${op.course.name}${op.roundNo ? ` · ${op.roundNo}${/[차회]/.test(op.roundNo) ? "" : "회차"}` : ""}` : coach?.name ?? (course ? `${course.company.name} · ${course.name}` : company?.name);
    const savedLabel = changedText(row.changes, "name") ?? changedText(row.changes, "course_name") ?? changedText(row.changes, "title");
    return { ...row, targetLabel: targetLabel ?? savedLabel, labelSource: targetLabel ? "현재 정보" : savedLabel ? "기록 당시" : null,
      targetHref: op ? `/operations/${encodeURIComponent(op.operationId)}` : coach && !coach.deletedAt ? `/coaches/${coach.id}` : null,
      description: row.targetType === "calendar_event_links" ? ({ create: "교육 일정의 캘린더 연결을 등록했습니다", update: "교육 일정의 캘린더 연결을 수정했습니다", delete: "교육 일정의 캘린더 연결을 삭제했습니다" } as Record<string, string>)[row.action] : undefined };
  });
}
