import { createHash } from "node:crypto";
import { Prisma, type Course } from "@prisma/client";
import { getPrismaClient } from "@/lib/data/prisma";
import { normalizeCourseId } from "@/lib/data/operationCalculations";

/** 한 세션의 현재 상태와 되돌릴 값. */
export interface CourseNameRestoreRow {
  companyName: string;
  /** 원천 기록이 없어 되돌릴 수 없는 이유(있으면 restorable=false). */
  blockedReason: null | string;
  currentCourseName: string;
  endDate: string;
  operationId: string;
  restorable: boolean;
  roundNo: string;
  /** 원천 적재 당시의 과정명. 없으면 null. */
  sourceCourseName: null | string;
  startDate: string;
  updatedAt: string;
  updatedBy: null | string;
}

/** 이 코스ID가 가진 과정 행. 세션 0개인 행은 합쳐지기 전 이름이 남은 흔적이다. */
export interface CourseNameRestoreCourse {
  companyName: string;
  courseName: string;
  id: string;
  sessionCount: number;
  updatedAt: string;
}

export interface CourseNameRestorePlan {
  snapshot: string;
  companyNames: string[];
  courseId: string;
  courses: CourseNameRestoreCourse[];
  rows: CourseNameRestoreRow[];
}

export interface CourseNameRestoreResult {
  moved: Array<{ from: string; operationId: string; to: string }>;
  skipped: Array<{ operationId: string; reason: string }>;
}

export class CourseNameRestoreConflict extends Error {
  constructor(message = "조회 이후 데이터가 바뀌었습니다. 다시 조회하고 선택해 주세요.") { super(message); }
}

function sourceName(value: Prisma.JsonValue | null): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  return typeof value.courseName === "string" ? value.courseName.trim() || null : null;
}

function metadata(course: Course) {
  return { operationType: course.operationType, courseCategory: course.courseCategory, tools: course.tools,
    revenue: course.revenue, revenueRaw: course.revenueRaw };
}

async function readPlan(tx: Prisma.TransactionClient, courseId: string) {
  // 먼저 식별자만 정규화한다. 다른 코스의 회차와 원천 기록까지 모두 읽지 않는다.
  const identifiers = await tx.course.findMany({ select: { id: true, courseId: true } });
  const ids = identifiers.filter((course) => normalizeCourseId(course.courseId) === courseId).map((course) => course.id);
  const courses = await tx.course.findMany({
    where: { id: { in: ids } }, orderBy: { id: "asc" },
    include: { company: { select: { name: true } }, sessions: {
      where: { deletedAt: null }, orderBy: { id: "asc" },
      select: { id: true, operationId: true, courseRecordId: true, updatedAt: true, updatedBy: true,
        startDate: true, endDate: true, roundNo: true,
        sourceRecords: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2,
          select: { id: true, createdAt: true, mappedFields: true } } }
    } }
  });
  const entries = courses.flatMap((course) => course.sessions.map((session) => {
    const [latest, previous] = session.sourceRecords;
    const name = sourceName(latest?.mappedFields ?? null);
    const candidates = courses.filter((target) => target.companyId === course.companyId && target.name === name);
    const blockedReason = !name ? "원천 과정명이 없습니다."
      : previous && latest.createdAt.getTime() === previous.createdAt.getTime() ? "최신 원천 기록의 시각이 같아 복원 근거를 확정할 수 없습니다."
      : name === course.name ? "원천 과정명과 현재 과정명이 같습니다."
      : candidates.length > 1 ? "같은 기업·코스ID·과정명의 대상이 여러 개입니다."
      : null;
    return { course, session, name, target: candidates[0], blockedReason };
  }));
  // 새 과정 하나를 만들면서 서로 다른 메타데이터 중 하나를 임의로 선택하지 않는다.
  const metadataByDestination = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.blockedReason || entry.target) continue;
    const key = JSON.stringify([entry.course.companyId, entry.name]);
    const values = metadataByDestination.get(key) ?? new Set<string>();
    values.add(JSON.stringify(metadata(entry.course)));
    metadataByDestination.set(key, values);
  }
  for (const entry of entries) {
    if (!entry.target && (metadataByDestination.get(JSON.stringify([entry.course.companyId, entry.name]))?.size ?? 0) > 1) {
      entry.blockedReason = "새 과정에 복사할 유형·도구·매출 정보가 서로 다릅니다.";
    }
  }
  // 이 지문은 권한 토큰이 아니다. 이름과 대상은 항상 서버 원천에서 다시 결정한다.
  const snapshot = createHash("sha256").update(JSON.stringify({ courseId, courses })).digest("hex");
  const plan: CourseNameRestorePlan = {
    snapshot, courseId, companyNames: [...new Set(courses.map((course) => course.company.name))].sort(),
    courses: courses.map((course) => ({ id: course.id, companyName: course.company.name, courseName: course.name, sessionCount: course.sessions.length, updatedAt: course.updatedAt.toISOString() })),
    rows: entries.map(({ course, session, name, blockedReason }) => ({
      companyName: course.company.name, blockedReason, currentCourseName: course.name, sourceCourseName: name, restorable: blockedReason === null,
      operationId: session.operationId, roundNo: session.roundNo ?? "", updatedBy: session.updatedBy,
      updatedAt: session.updatedAt.toISOString(), startDate: session.startDate?.toISOString().slice(0, 10) ?? "",
      endDate: session.endDate?.toISOString().slice(0, 10) ?? ""
    })).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.operationId.localeCompare(b.operationId))
  };
  return { plan, entries };
}

export async function planCourseNameRestore(rawCourseId: string, db = getPrismaClient()): Promise<CourseNameRestorePlan> {
  return db.$transaction(async (tx) => (await readPlan(tx, normalizeCourseId(rawCourseId))).plan,
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function applyCourseNameRestore(rawCourseId: string, operationIds: string[], snapshot: string,
  actorEmail: string | null, db = getPrismaClient()): Promise<CourseNameRestoreResult> {
  if (!operationIds.length || operationIds.length > 100 || new Set(operationIds).size !== operationIds.length) {
    throw new CourseNameRestoreConflict("중복 없이 1~100개 회차를 선택해 주세요.");
  }
  try {
    // 계획 비교, 과정 생성, 모든 회차 이동, 기존 활동 감사 트리거를 한 트랜잭션으로 묶는다.
    return await db.$transaction(async (tx) => {
      const { plan, entries } = await readPlan(tx, normalizeCourseId(rawCourseId));
      if (snapshot !== plan.snapshot) throw new CourseNameRestoreConflict();
      const selected = operationIds.map((id) => entries.find((entry) => entry.session.operationId === id));
      if (selected.some((entry) => !entry || entry.blockedReason || !entry.name)) {
        throw new CourseNameRestoreConflict("선택한 회차 중 복원할 수 없는 항목이 있습니다. 다시 조회해 주세요.");
      }
      const moved: CourseNameRestoreResult["moved"] = [];
      const created = new Map<string, string>();
      for (const entry of selected) {
        if (!entry || !entry.name) throw new CourseNameRestoreConflict();
        const { course, session, name } = entry;
        const key = JSON.stringify([course.companyId, name]);
        let targetId = entry.target?.id ?? created.get(key);
        if (!targetId) {
          const target = await tx.course.create({ data: { companyId: course.companyId,
            courseId: normalizeCourseId(rawCourseId), name, ...metadata(course) } });
          targetId = target.id;
          created.set(key, targetId);
        }
        const changed = await tx.operationSession.updateMany({
          where: { id: session.id, courseRecordId: course.id, updatedAt: session.updatedAt, deletedAt: null },
          data: { courseRecordId: targetId, updatedBy: actorEmail }
        });
        if (changed.count !== 1) throw new CourseNameRestoreConflict();
        moved.push({ operationId: session.operationId, from: course.name, to: name });
      }
      return { moved, skipped: [] };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) {
      throw new CourseNameRestoreConflict();
    }
    throw error;
  }
}
