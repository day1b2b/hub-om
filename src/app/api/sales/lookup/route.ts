import { NextResponse } from "next/server";
import { resolveCourseLookup } from "@/lib/data/courseLookup";
import { normalizeCourseId } from "@/lib/data/operationCalculations";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { hasSalesmapConfig, SalesmapSourceReader } from "@/lib/sourceReads/salesmapSourceReader";
import { waitAtMost } from "@/lib/waitAtMost";

/**
 * 코스ID → {고객사, 과정명} 읽기 전용 조회.
 *
 * 만족도 분석기(survey_analysis) 같은 외부 로컬 도구가 코스ID를 입력할 때 고객사·과정명을
 * 자동 채우도록 돕는 가벼운 조회 엔드포인트다.
 *
 * 원천은 두 개이고 순서가 있다:
 *   1. **운영현황(hub-om DB)** — 만족도를 돌리는 과정은 이미 운영현황에 등록된 과정이므로 여기가 원천이다.
 *      코스ID 하나를 인덱스로 찾는 DB 조회라 즉시 답한다.
 *   2. 세일즈맵 — 운영현황에 아직 없는 과정을 위한 폴백. 딜 전체를 읽어야 해서 느리므로
 *      캐시가 비어 있으면 `warming`으로 먼저 답하고 읽기는 뒤에서 계속한다.
 *
 * 응답의 `source`로 어느 원천에서 온 값인지 알려준다.
 *
 * 보안:
 *   - 공유 토큰(`COURSE_LOOKUP_TOKEN`)이 있어야만 응답한다. 토큰은 저장소에 두지 않고
 *     배포 환경변수로만 주입한다(세일즈맵 토큰과 동일 원칙).
 *   - 매출(revenue)은 반환하지 않는다 — 자동 채움에 필요한 고객사·과정명만 노출한다.
 *   - 설정/토큰이 없으면 survey는 기존 로컬 학습으로 폴백하므로, 실패해도 조용히 넘어갈 수 있게
 *     명확한 코드로 응답한다.
 */

export const dynamic = "force-dynamic";

/** 응답을 기다리는 상한(ms). 이 시간을 넘으면 읽기는 뒤에서 계속하고 먼저 응답한다. */
const DEFAULT_LOOKUP_DEADLINE_MS = 6000;

function readLookupDeadlineMs(): number {
  const configured = Number(process.env.COURSE_LOOKUP_DEADLINE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LOOKUP_DEADLINE_MS;
}

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

/** 고객사명 검색이 돌려줄 후보 수. 한 고객사에 과정이 수백 개일 수 있어 반드시 자른다. */
function readSearchLimit(raw: null | string): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SEARCH_LIMIT;
  return Math.min(parsed, MAX_SEARCH_LIMIT);
}

/** 요청에서 공유 토큰을 꺼낸다: `Authorization: Bearer` → `x-lookup-token` → `?token=` 순. */
function readRequestToken(request: Request, url: URL): string {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  return bearer || (request.headers.get("x-lookup-token") ?? "").trim() || (url.searchParams.get("token") ?? "").trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const expectedToken = process.env.COURSE_LOOKUP_TOKEN?.trim() ?? "";
  if (!expectedToken) {
    // 서버에 조회 토큰이 설정되지 않음 → 기능 자체가 꺼진 상태.
    return NextResponse.json(
      { ok: false, configured: false, error: "코스ID 조회가 설정되지 않았습니다(COURSE_LOOKUP_TOKEN)." },
      { status: 503 }
    );
  }

  const providedToken = readRequestToken(request, url);
  if (providedToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "인증 토큰이 올바르지 않습니다." }, { status: 401 });
  }

  // 고객사명 검색 모드 — 코스ID를 모를 때(6자리 숫자라 외우기 어렵다) 아는 값에서 출발한다.
  // 운영현황만 본다. 세일즈맵 역방향 검색은 딜 전체를 읽어야 해서 이 용도에 맞지 않는다.
  const companyQuery = (url.searchParams.get("company") ?? "").trim();
  if (companyQuery) {
    const courseQuery = (url.searchParams.get("course") ?? "").trim();
    const limit = readSearchLimit(url.searchParams.get("limit"));
    const found = await getOperationRepository().findCoursesByCompany(companyQuery, courseQuery, limit);

    return NextResponse.json({
      ok: true,
      mode: "company",
      source: "operations",
      query: { company: companyQuery, course: courseQuery },
      // limit보다 하나 더 받아 잘렸는지 판단한다(호출자가 '더 좁혀 주세요'를 안내할 수 있게).
      truncated: found.length > limit,
      candidates: found.slice(0, limit).map((candidate) => ({
        courseId: candidate.courseId,
        company: candidate.companyName,
        courseName: candidate.courseName,
        latestStartDate: candidate.latestStartDate
      }))
    });
  }

  const courseId = (url.searchParams.get("courseId") ?? "").trim();
  if (!courseId) {
    return NextResponse.json({ ok: false, error: "courseId 또는 company가 필요합니다." }, { status: 400 });
  }

  // 1) 운영현황(hub-om DB)에서 먼저 찾는다 — 원천이자 가장 빠른 경로.
  const candidates = await getOperationRepository().findCoursesByCourseId(courseId);
  const resolved = resolveCourseLookup(candidates);

  if (resolved && (resolved.company || resolved.courseName)) {
    return NextResponse.json({
      ok: true,
      found: true,
      source: "operations",
      courseId,
      company: resolved.company,
      courseName: resolved.courseName,
      // 한 코스ID에 과정이 여럿이면 과정명은 비워 보낸다(호출자가 안내 문구에 쓴다).
      ambiguous: resolved.ambiguous,
      candidateCount: resolved.candidateCount
    });
  }

  // 운영현황에 과정은 있는데 고객사까지 갈려서 채울 값이 없는 경우 — 세일즈맵을 봐도 답이 갈리므로 여기서 끝낸다.
  if (resolved) {
    return NextResponse.json({
      ok: true,
      found: false,
      source: "operations",
      courseId,
      ambiguous: true,
      candidateCount: resolved.candidateCount
    });
  }

  // 2) 운영현황에 없으면 세일즈맵으로 폴백.
  if (!hasSalesmapConfig()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "세일즈맵이 설정되지 않았습니다." },
      { status: 200 }
    );
  }

  const readPromise = new SalesmapSourceReader().readSalesRecords();
  // 시간이 지나 먼저 응답한 뒤에 읽기가 실패하면 처리되지 않은 rejection이 되므로 미리 받아둔다.
  void readPromise.catch(() => undefined);

  // 세일즈맵 딜 전체 읽기는 최대 20페이지(페이지마다 지연·429 재시도)라 수십 초~분 단위로 걸린다.
  // 자동 채움을 부르는 로컬 도구는 그만큼 기다리지 못하므로 여기서 먼저 끊는다.
  const read = await waitAtMost(readPromise, readLookupDeadlineMs());
  if (!read) {
    // 아직 캐시가 비어 있어 딜을 처음 읽는 중. 호출자는 조용히 폴백하고 잠시 뒤 다시 물어보면 된다.
    return NextResponse.json(
      { ok: true, found: false, source: "salesmap", courseId, warming: true },
      { status: 200 }
    );
  }

  if (read.status === "failed") {
    return NextResponse.json(
      { ok: false, error: read.issues[0]?.message ?? "세일즈맵 딜을 읽지 못했습니다." },
      { status: 502 }
    );
  }

  const target = normalizeCourseId(courseId);
  const match = read.items.find((record) => record.courseId != null && normalizeCourseId(record.courseId) === target);

  if (!match) {
    // 부분 조회(partial)면 아직 못 읽은 딜에 있을 수 있으므로 그 사실을 알려준다.
    return NextResponse.json({
      ok: true,
      found: false,
      source: "salesmap",
      courseId,
      partial: read.status === "partial"
    });
  }

  const { company, courseName } = deriveCompanyAndCourse(match.companyName, match.courseName);

  return NextResponse.json({
    ok: true,
    found: true,
    source: "salesmap",
    courseId,
    company,
    courseName
  });
}

/**
 * 고객사·과정명을 정리한다.
 *
 * 세일즈맵 딜에 '고객사'가 별도 필드로 채워져 있지 않고 딜 이름이 "고객사_과정명" 형식인 경우가 있어
 * (예: "KT(대외교육협력팀)_AI 활용역량 향상 교육"), 고객사 필드가 비어 있으면 딜 이름 앞부분에서
 * 고객사를, 뒷부분에서 과정명을 유추한다. survey_analysis 자동 채움용 폴백이며, 채워진 값은 사용자가
 * 항상 수정할 수 있다. 고객사 필드가 이미 있으면 그대로 존중하고 아무것도 바꾸지 않는다.
 */
function deriveCompanyAndCourse(
  companyName: string | undefined,
  courseName: string | undefined
): { company: string; courseName: string } {
  const company = companyName?.trim() ?? "";
  const rawCourseName = courseName?.trim() ?? "";

  if (company || !rawCourseName.includes("_")) {
    return { company, courseName: rawCourseName };
  }

  const separatorIndex = rawCourseName.indexOf("_");
  // 괄호 안 부서/설명은 떼어낸다: "KT(대외교육협력팀)" → "KT".
  const derivedCompany = rawCourseName.slice(0, separatorIndex).replace(/\(.*?\)/g, "").trim();
  const derivedCourse = rawCourseName.slice(separatorIndex + 1).trim();

  return {
    company: derivedCompany || company,
    courseName: derivedCourse || rawCourseName
  };
}
