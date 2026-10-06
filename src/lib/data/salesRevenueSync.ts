import { getPrismaClient } from "@/lib/data/prisma";
import { hasSalesmapConfig, SalesmapSourceReader } from "@/lib/sourceReads/salesmapSourceReader";

/**
 * 세일즈맵 매출을 hub-om `courses.revenue`에 반영한다.
 * 매칭 열쇠는 코스ID(`courses.course_id`)이고, 세일즈맵 `금액`으로 매출 칸을 덮어쓴다.
 * 관리자 sync 페이지의 "미리보기 → 반영" 흐름을 위해 apply 플래그로 조회/쓰기를 나눈다.
 * 실제 쓰기 권한은 호출하는 API 라우트(assertAdminSession)에서 강제한다.
 */

export interface SalesRevenueChange {
  courseId: string;
  companyName?: string;
  courseName?: string;
  before: number | null;
  after: number;
  action: "fill" | "change" | "same";
}

/** 금액이 다른 다중 딜의 처리 방식. 합산/최대/최소/제외 중 관리자가 선택(기본 합산). */
export type MultiDealMode = "sum" | "max" | "min" | "exclude";

/**
 * 한 코스ID에 세일즈맵 딜이 여러 개인데 **금액이 서로 다른** 건(처리 방식 선택 대상).
 * 금액이 모두 같은 건(복붙 중복)은 1건 금액만 자동 반영하므로 이 목록엔 넣지 않는다.
 */
export interface MultiDealCourseInfo {
  courseId: string;
  dealCount: number;
  /** 합산액(딜 금액 합). */
  sum: number;
  /** 딜 중 최대/최소 금액. */
  max: number;
  min: number;
  /** 현재 선택된 처리 방식(기본 sum). */
  mode: MultiDealMode;
  /** 위 mode로 실제 반영되는 금액(exclude면 반영 안 함). */
  appliedAmount: number;
  companyName?: string;
  courseName?: string;
}

export interface SalesRevenueSyncResult {
  configured: boolean;
  readStatus: string;
  readCount: number;
  matchedCourseIds: number;
  filled: number;
  changed: number;
  unchanged: number;
  updatedRows: number;
  unmatchedCourseIds: string[];
  multiCourseIds: string[];
  /** 금액이 다른 다중 딜 목록(합산/최대/최소/제외 중 선택 대상). */
  multiDealCourseIds: MultiDealCourseInfo[];
  /** 이번 반영에서 제외한 코스ID(mode=exclude, 반영 안 됨·기존 매출 유지). */
  excludedCourseIds: string[];
  /** 금액 동일 중복으로 보고 합산 대신 1건 금액만 자동 반영한 코스ID(안내용, 선택 불필요). */
  dedupedCourseIds: string[];
  applied: boolean;
  changes: SalesRevenueChange[];
  issues: string[];
}

interface CourseRow {
  id: string;
  courseId: string;
  name: string;
  revenue: unknown;
  company: { name: string } | null;
}

export async function runSalesRevenueSync({
  apply,
  actorEmail,
  multiDealResolutions = {}
}: {
  apply: boolean;
  actorEmail: string;
  /**
   * 금액이 다른 다중 딜의 코스ID별 처리 방식(코스ID → 합산/최대/최소/제외).
   * 지정 안 하면 기본 '합산'. 금액이 같은 중복 딜은 이 설정과 무관하게 1건 금액만 자동 반영한다.
   */
  multiDealResolutions?: Record<string, MultiDealMode>;
}): Promise<SalesRevenueSyncResult> {
  if (!hasSalesmapConfig()) {
    return emptyResult("disabled", ["세일즈맵 토큰(SALESMAP_API_TOKEN)이 설정되지 않았습니다."], false);
  }

  const read = await new SalesmapSourceReader().readSalesRecords();
  const records = read.items.filter(
    (record): record is typeof record & { courseId: string; revenue: number } =>
      Boolean(record.courseId) && record.revenue != null
  );

  // 처리 방식을 정규화된 코스ID 기준으로 조회 가능하게 변환.
  const resolutionByNormalizedId = new Map<string, MultiDealMode>();
  for (const [rawId, mode] of Object.entries(multiDealResolutions)) {
    resolutionByNormalizedId.set(normalizeCourseId(rawId), mode);
  }

  if (read.status === "failed") {
    return emptyResult(read.status, read.issues.map((issue) => issue.message), true);
  }

  const prisma = getPrismaClient();
  // hub-om 코스ID에 눈에 안 보이는 문자(제로폭 공백 등)나 공백이 섞여 매칭이 안 되는 경우가 있어,
  // 양쪽 코스ID를 정규화(보이지 않는 문자 제거 + trim)한 뒤 맞춘다.
  const normalizedRecordIds = new Set(records.map((record) => normalizeCourseId(record.courseId)));
  const courses: CourseRow[] = await prisma.course.findMany({
    where: { courseId: { not: "" } },
    select: { id: true, courseId: true, name: true, revenue: true, company: { select: { name: true } } }
  });

  const coursesByCourseId = new Map<string, CourseRow[]>();
  for (const course of courses) {
    const normalized = normalizeCourseId(course.courseId);
    if (!normalized || !normalizedRecordIds.has(normalized)) continue;
    const list = coursesByCourseId.get(normalized) ?? [];
    list.push(course);
    coursesByCourseId.set(normalized, list);
  }

  const changes: SalesRevenueChange[] = [];
  const unmatchedCourseIds: string[] = [];
  const multiCourseIds: string[] = [];
  const multiDealCourseIds: MultiDealCourseInfo[] = [];
  const excludedCourseIds: string[] = [];
  const dedupedCourseIds: string[] = [];
  let matchedCourseIds = 0;
  let filled = 0;
  let changed = 0;
  let unchanged = 0;
  const pendingUpdates: Array<{ id: string; revenue: number }> = [];

  for (const record of records) {
    const matched = coursesByCourseId.get(normalizeCourseId(record.courseId));
    if (!matched || matched.length === 0) {
      unmatchedCourseIds.push(record.courseId);
      continue;
    }
    matchedCourseIds += 1;

    // 같은 코스ID가 여러 과정 행에 걸리면 과정별로 모두 채운다(화면 표시용).
    // 대시보드 총 매출은 과정(Course.id)당 1번만 집계하므로 같은 과정 안 회차 중복은 없지만,
    // 이 경우처럼 코스ID 하나가 과정 여러 건에 걸치면 그만큼 여러 번 집계된다 -> multiCourseIds로 별도 표시.
    if (matched.length > 1) {
      multiCourseIds.push(record.courseId);
    }

    const dealCount = record.dealCount ?? 1;
    const sum = record.revenue;
    const max = record.maxAmount ?? record.revenue;
    const min = record.minAmount ?? record.revenue;
    const sameAmount = record.dealsSameAmount ?? true;

    // 다중 딜의 실제 반영 금액을 정한다.
    //  - 단일 딜: 그대로.
    //  - 금액 동일 다중 딜(복붙 중복): 1건 금액만 자동 반영(합산 뻥튀기 방지). 선택 UI에 안 띄운다.
    //  - 금액 다른 다중 딜: 관리자 선택(기본 합산). exclude면 반영 건너뜀.
    let effectiveRevenue = sum;
    let excludedHere = false;

    if (dealCount > 1 && sameAmount) {
      effectiveRevenue = max; // = min = 1건 금액
      dedupedCourseIds.push(record.courseId);
    } else if (dealCount > 1) {
      const mode = resolutionByNormalizedId.get(normalizeCourseId(record.courseId)) ?? "sum";
      effectiveRevenue = mode === "max" ? max : mode === "min" ? min : sum;
      excludedHere = mode === "exclude";
      multiDealCourseIds.push({
        courseId: record.courseId,
        dealCount,
        sum,
        max,
        min,
        mode,
        appliedAmount: excludedHere ? 0 : effectiveRevenue,
        companyName: matched[0]?.company?.name,
        courseName: matched[0]?.name
      });
    }

    // 제외 선택 시 반영하지 않는다(기존 매출 그대로 유지).
    if (excludedHere) {
      excludedCourseIds.push(record.courseId);
      continue;
    }

    for (const course of matched) {
      const before = toNumber(course.revenue);
      const after = effectiveRevenue;
      const action: SalesRevenueChange["action"] =
        before === null ? "fill" : before !== after ? "change" : "same";

      if (action === "same") {
        unchanged += 1;
      } else {
        if (action === "fill") filled += 1;
        else changed += 1;
        pendingUpdates.push({ id: course.id, revenue: after });
      }

      changes.push({
        courseId: record.courseId,
        companyName: course.company?.name,
        courseName: course.name,
        before,
        after,
        action
      });
    }
  }

  // 일부만 읽은(partial) 상태에서는 값이 부분 합산일 수 있으므로 실제 쓰기를 막는다.
  const blockedByPartial = apply && read.status === "partial";
  const issues = read.issues.map((issue) => issue.message);
  let updatedRows = 0;

  if (apply && !blockedByPartial && pendingUpdates.length > 0) {
    // 전부 성공 아니면 전부 취소(중간 실패 시 절반만 써지는 것 방지).
    // 첫 대량 반영(수백 건)에서도 기본 시간제한에 걸리지 않도록 인터랙티브 트랜잭션 + 넉넉한 timeout.
    await prisma.$transaction(
      async (tx) => {
        for (const update of pendingUpdates) {
          await tx.course.update({
            where: { id: update.id },
            data: { revenue: update.revenue, revenueRaw: String(update.revenue) }
          });
        }
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
    updatedRows = pendingUpdates.length;
  }

  if (blockedByPartial) {
    issues.push("세일즈맵 딜을 일부만 읽어(partial) 반영을 막았습니다. SALESMAP_MAX_PAGES를 올린 뒤 다시 시도하세요.");
  }

  const result: SalesRevenueSyncResult = {
    configured: true,
    readStatus: read.status,
    readCount: records.length,
    matchedCourseIds,
    filled,
    changed,
    unchanged,
    updatedRows,
    unmatchedCourseIds,
    multiCourseIds,
    multiDealCourseIds,
    excludedCourseIds,
    dedupedCourseIds,
    applied: apply && !blockedByPartial,
    changes,
    issues
  };

  // 감사 로그: 실제 반영 시도(POST)만 기록한다. 로그 실패가 동기화를 막지 않도록 격리한다.
  if (apply) {
    try {
      await prisma.salesRevenueSyncLog.create({
        data: {
          status: result.readStatus,
          applied: result.applied,
          readCount: result.readCount,
          matched: result.matchedCourseIds,
          filled: result.filled,
          changed: result.changed,
          unchanged: result.unchanged,
          updatedRows: result.updatedRows,
          unmatched: result.unmatchedCourseIds.length,
          ambiguous: result.multiCourseIds.length,
          triggeredBy: actorEmail,
          detail: {
            unmatchedCourseIds: result.unmatchedCourseIds.slice(0, 500),
            multiCourseIds: result.multiCourseIds.slice(0, 500),
            multiDealCourseIds: result.multiDealCourseIds.slice(0, 500).map((m) => m.courseId),
            excludedCourseIds: result.excludedCourseIds.slice(0, 500),
            dedupedCourseIds: result.dedupedCourseIds.slice(0, 500),
            issues: result.issues
          }
        }
      });
    } catch {
      // 감사 로그 기록 실패는 무시(동기화 결과에 영향 주지 않음).
    }
  }

  return result;
}

/** 코스ID 비교용 정규화: 제로폭 공백 등 보이지 않는 문자를 제거하고 앞뒤 공백을 없앤다. */
function normalizeCourseId(value: string): string {
  return value.replace(/[​-‍﻿ ]/g, "").trim();
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyResult(readStatus: string, issues: string[], configured: boolean): SalesRevenueSyncResult {
  return {
    configured,
    readStatus,
    readCount: 0,
    matchedCourseIds: 0,
    filled: 0,
    changed: 0,
    unchanged: 0,
    updatedRows: 0,
    unmatchedCourseIds: [],
    multiCourseIds: [],
    multiDealCourseIds: [],
    excludedCourseIds: [],
    dedupedCourseIds: [],
    applied: false,
    changes: [],
    issues
  };
}
