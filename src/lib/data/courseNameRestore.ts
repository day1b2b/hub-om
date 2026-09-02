import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/lib/data/prisma";
import { normalizeCourseId } from "@/lib/data/operationCalculations";

/**
 * 과정명 되돌리기.
 *
 * 왜 필요한가:
 *   운영 상세의 과정명 수정은 "그 세션을 다른 과정(Course) 행으로 옮기는" 동작이다
 *   (prismaOperationRepository.updateOperation — course.upsert 후 courseRecordId 교체).
 *   같은 코스ID 안에 과정이 여럿일 때 이미 있는 과정명으로 바꾸면 두 과정이 한 과정으로
 *   합쳐진다. 화면에는 되돌릴 방법이 없고, 원래 과정명이 어디에 있었는지도 안 보인다.
 *   2026-09-02 코스ID 263102(홈앤서비스)에서 20회차가 한 과정으로 합쳐지는 사고가 났다.
 *
 * 되돌릴 값은 어디서 오나:
 *   원천 적재 기록(OperationSourceRecord.mappedFields.courseName)에 **적재 당시의 과정명**이
 *   그대로 남아 있고, 과정명 수정은 이 테이블을 건드리지 않는다. 그래서 추측하지 않고
 *   원천 값을 그대로 복원한다. 원천 기록이 없는 세션(화면에서 직접 만든 건)은 되돌릴 근거가
 *   없으므로 복원 대상에서 제외하고 그 사실을 화면에 표시한다.
 *
 * 안전 규칙 (docs/operations/db-write-safety.md):
 *   - 미리보기(planCourseNameRestore)와 적용(applyCourseNameRestore)이 분리돼 있다.
 *   - 적용은 admin이 화면에서 명시적으로 고른 세션에만 실행한다(자동 실행 없음).
 *   - 수정 필드는 operation_sessions.course_record_id 하나뿐이다.
 *   - 물리 삭제·스키마 변경 없음. 비어 버린 과정 행은 그대로 남긴다(다음 복구의 근거).
 *   - 원천 과정명이 현재와 같으면 건드리지 않는다.
 */

/** 한 세션의 현재 상태와 되돌릴 값. */
export interface CourseNameRestoreRow {
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
  courseName: string;
  id: string;
  sessionCount: number;
  updatedAt: string;
}

export interface CourseNameRestorePlan {
  companyNames: string[];
  courseId: string;
  courses: CourseNameRestoreCourse[];
  rows: CourseNameRestoreRow[];
}

export interface CourseNameRestoreResult {
  moved: Array<{ from: string; operationId: string; to: string }>;
  skipped: Array<{ operationId: string; reason: string }>;
}

function toDateString(value: Date | null): string {
  if (!value) return "";
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** mappedFields(Json)에서 과정명만 문자열로 꺼낸다. 형식이 예상과 달라도 던지지 않는다. */
function readSourceCourseName(mappedFields: Prisma.JsonValue | null): null | string {
  if (!mappedFields || Array.isArray(mappedFields) || typeof mappedFields !== "object") return null;
  const value = (mappedFields as Record<string, unknown>).courseName;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * 코스ID 하나에 대한 복구 계획을 읽는다. 아무것도 쓰지 않는다.
 *
 * 정규화: 코스ID에 제로폭 공백이 섞여 들어오는 일이 반복돼서(normalizeCourseId), 입력과
 * DB 값 양쪽을 정규화해 비교한다. 정규화 없이 찾으면 사고 난 과정을 못 찾는다.
 */
export async function planCourseNameRestore(rawCourseId: string): Promise<CourseNameRestorePlan> {
  const courseId = normalizeCourseId(rawCourseId);

  if (!courseId) {
    return { companyNames: [], courseId: "", courses: [], rows: [] };
  }

  const prisma = getPrismaClient();

  // 코스ID가 제로폭 공백 등으로 흔들려 있어도 잡히도록 후보를 넓게 읽고 JS에서 정규화 비교한다.
  const courses = await prisma.course.findMany({
    include: {
      company: true,
      sessions: {
        include: { sourceRecords: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: [{ startDate: "asc" }],
        where: { deletedAt: null }
      }
    }
  });

  const matched = courses.filter((course) => normalizeCourseId(course.courseId) === courseId);

  const rows: CourseNameRestoreRow[] = [];
  const companyNames = new Set<string>();

  for (const course of matched) {
    companyNames.add(course.company.name);

    for (const session of course.sessions) {
      const sourceCourseName = readSourceCourseName(session.sourceRecords[0]?.mappedFields ?? null);
      const sameAsNow = sourceCourseName !== null && sourceCourseName === course.name;

      rows.push({
        blockedReason:
          sourceCourseName === null
            ? "원천 적재 기록이 없어 되돌릴 과정명을 알 수 없습니다."
            : sameAsNow
              ? "원천 과정명과 현재 과정명이 같습니다."
              : null,
        currentCourseName: course.name,
        endDate: toDateString(session.endDate),
        operationId: session.operationId,
        restorable: sourceCourseName !== null && !sameAsNow,
        roundNo: session.roundNo ?? "",
        sourceCourseName,
        startDate: toDateString(session.startDate),
        updatedAt: session.updatedAt.toISOString(),
        updatedBy: session.updatedBy
      });
    }
  }

  return {
    companyNames: [...companyNames].sort((a, b) => a.localeCompare(b, "ko-KR")),
    courseId,
    courses: matched
      .map((course) => ({
        courseName: course.name,
        id: course.id,
        sessionCount: course.sessions.length,
        updatedAt: course.updatedAt.toISOString()
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    rows: rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.roundNo.localeCompare(b.roundNo))
  };
}

/**
 * 고른 세션을 원천 과정명의 과정 행으로 되돌린다.
 *
 * 계획을 다시 읽어 대조한 뒤 적용한다 — 화면이 열려 있는 동안 데이터가 바뀌었을 수 있고,
 * 그때는 화면에 보이던 값이 아니라 지금 값이 기준이어야 한다.
 */
export async function applyCourseNameRestore(
  rawCourseId: string,
  operationIds: string[],
  actorEmail: null | string
): Promise<CourseNameRestoreResult> {
  const plan = await planCourseNameRestore(rawCourseId);
  const wanted = new Set(operationIds);
  const targets = plan.rows.filter((row) => wanted.has(row.operationId));

  const moved: CourseNameRestoreResult["moved"] = [];
  const skipped: CourseNameRestoreResult["skipped"] = [];

  for (const operationId of operationIds) {
    if (!targets.some((row) => row.operationId === operationId)) {
      skipped.push({ operationId, reason: "이 코스ID의 복구 대상이 아닙니다." });
    }
  }

  const prisma = getPrismaClient();

  for (const row of targets) {
    if (!row.restorable || !row.sourceCourseName) {
      skipped.push({ operationId: row.operationId, reason: row.blockedReason ?? "되돌릴 수 없습니다." });
      continue;
    }

    // 클로저 안에서는 위 좁히기가 유지되지 않는다 — 값을 지역 상수로 고정한다.
    const restoreName = row.sourceCourseName;

    await prisma.$transaction(async (tx) => {
      const session = await tx.operationSession.findUnique({
        include: { course: true },
        where: { operationId: row.operationId }
      });

      if (!session) {
        skipped.push({ operationId: row.operationId, reason: "세션을 찾지 못했습니다." });
        return;
      }

      // 원래 과정 행을 먼저 찾아 그대로 재사용한다.
      //   upsert 만 쓰면 안 되는 이유: where 는 courseId 를 '정확히' 비교하는데, 실제 데이터에는
      //   코스ID에 제로폭 공백이 섞인 행이 있다(255413 vs 255413​). 그러면 원래 행을 못 찾고
      //   깨끗한 코스ID로 새 행을 만들어, 같은 과정이 두 행으로 갈라진다.
      const reusable = await tx.course.findFirst({
        where: { companyId: session.course.companyId, name: restoreName }
      });
      const sameCourseId =
        reusable !== null &&
        normalizeCourseId(reusable.courseId) === normalizeCourseId(session.course.courseId);

      const course = sameCourseId && reusable ? reusable : await tx.course.upsert({
        create: {
          companyId: session.course.companyId,
          courseId: session.course.courseId,
          name: restoreName,
          operationType: session.course.operationType,
          revenue: session.course.revenue,
          revenueRaw: session.course.revenueRaw
        },
        update: {},
        where: {
          companyId_courseId_name: {
            companyId: session.course.companyId,
            courseId: session.course.courseId,
            name: restoreName
          }
        }
      });

      if (course.id === session.courseRecordId) {
        skipped.push({ operationId: row.operationId, reason: "이미 원천 과정명에 붙어 있습니다." });
        return;
      }

      await tx.operationSession.update({
        data: { courseRecordId: course.id, updatedBy: actorEmail },
        where: { operationId: row.operationId }
      });

      moved.push({ from: session.course.name, operationId: row.operationId, to: restoreName });
    });
  }

  return { moved, skipped };
}
