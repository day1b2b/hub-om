import { NextResponse } from "next/server";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { matchSatisfactionRow, toSatisfactionSheetRow } from "@/lib/data/satisfactionSheet";
import { planRoundApply } from "@/lib/data/satisfactionRoundApply";
import type { OperationCandidate } from "@/lib/data/operationMatch/matchOperation";

/**
 * 만족도 회차 단위 반영 (서버 간 호출용)
 *
 * 왜 있나:
 *   지금까지 만족도는 관리자가 `만족도 매칭` 화면에서 버튼을 눌러야 hub-om 에 들어왔다.
 *   OM 이 분석을 끝내고 앱에서 [hub-om 반영] 을 눌러도 시트까지만 가고, 운영 회차 만족도는
 *   관리자가 눌러줄 때까지 '미입력' 으로 남았다. 관리자 한 사람이 병목이었다.
 *   이 창구는 **그 회차 한 건만** 반영한다. 시트 전체를 한 번에 쓰는 기존 버튼보다 범위가 좁다.
 *
 * 인증:
 *   세션이 아니라 공유 토큰(`COURSE_LOOKUP_TOKEN`)으로 자체 인증한다 —
 *   api/sales/lookup·api/team-users/lookup 과 같은 방식이고, `src/proxy.ts` 매처에서 제외한다.
 *
 * 안전 규칙 (docs/operations/db-write-safety.md, 2026-08-10 도입 → 2026-08-31 개정):
 *   - matched 만 쓴다. 모호(ambiguous)·미매칭(unmatched)은 절대 쓰지 않는다. [유지]
 *   - 만족도 값이 비어 있으면 쓰지 않는다. [유지]
 *   - 물리 삭제·스키마 변경 없음. 수정 필드는 avgSatisfaction 하나뿐. [유지]
 *   - ★기존 값이 있어도 덮어쓴다. [변경]
 *     원래는 "사람이 손으로 넣은 값 보호"가 목적이었으나, hub-om 에 만족도 수기 입력 경로가
 *     없어 실제로 보호하던 것은 드라이브 임포트 값뿐이었다. 데이터 책임자(시트 관리자)가
 *     **시트를 원본으로** 확정했고, 드라이브 임포트 작성자도 변경에 동의했다(2026-08-31).
 *     덮어쓰지 않으면 틀린 값을 앱에서 고쳐도 hub-om 이 그대로 남아 사람이 직접 들어가야 한다.
 *
 * 응답:
 *   조용한 실패를 만들지 않는다 — 반영 못 한 이유를 그대로 돌려주고, 앱이 사용자에게 보여준다.
 */
export const dynamic = "force-dynamic";

/** 요청에서 공유 토큰을 꺼낸다: `Authorization: Bearer` → `x-lookup-token` → `?token=` 순. */
function readRequestToken(request: Request, url: URL): string {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  return bearer || (request.headers.get("x-lookup-token") ?? "").trim() || (url.searchParams.get("token") ?? "").trim();
}

interface RoundApplyBody {
  record_id?: string;
  courseId?: string;
  client?: string;
  course?: string;
  degree?: string;
  date?: string;
  audience?: string;
  instructor?: string;
  n?: string;
  overall?: string;
  pos_pct?: string;
  /** 누가 눌렀는지 — 담당 OM 과 다르면 응답에 알린다(막지는 않는다). */
  manager?: string;
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  const expectedToken = process.env.COURSE_LOOKUP_TOKEN?.trim() ?? "";
  if (!expectedToken) {
    return NextResponse.json(
      { ok: false, configured: false, error: "만족도 반영이 설정되지 않았습니다(COURSE_LOOKUP_TOKEN)." },
      { status: 503 }
    );
  }
  if (readRequestToken(request, url) !== expectedToken) {
    return NextResponse.json({ ok: false, error: "인증 토큰이 올바르지 않습니다." }, { status: 401 });
  }

  let body: RoundApplyBody;
  try {
    body = (await request.json()) as RoundApplyBody;
  } catch {
    return NextResponse.json({ ok: false, error: "요청 본문을 읽지 못했습니다." }, { status: 400 });
  }

  // 시트 한 줄과 같은 모양으로 맞춘다 — 매칭·정규화 로직을 그대로 재사용하기 위해서다.
  const row = toSatisfactionSheetRow({
    record_id: body.record_id ?? "",
    courseId: body.courseId ?? "",
    client: body.client ?? "",
    course: body.course ?? "",
    degree: body.degree ?? "",
    date: body.date ?? "",
    audience: body.audience ?? "",
    instructor: body.instructor ?? "",
    n: body.n ?? "",
    overall: body.overall ?? "",
    pos_pct: body.pos_pct ?? ""
  });

  try {
    const repository = getOperationRepository();
    const operations = await repository.listOperations();
    const candidates: OperationCandidate[] = operations.map((operation) => ({
      id: operation.id,
      operationId: operation.operationId,
      companyName: operation.companyName,
      courseName: operation.courseName,
      courseId: operation.courseId,
      startDate: operation.startDate,
      endDate: operation.endDate,
      coachText: operation.coach,
      instructorsText: operation.instructors
    }));

    // 쓸지 말지는 순수 함수가 정한다 — 안전 규칙이 한 곳에서만 판단되고 테스트로 고정된다.
    const match = matchSatisfactionRow(row, candidates);
    const decision = planRoundApply(row.overall, match, (id) => operations.find((item) => item.id === id));

    if (!decision.write) {
      return NextResponse.json({
        ok: true,
        applied: false,
        status: decision.status,
        message: decision.message,
        operation: decision.operationLabel ?? null,
        value: decision.value ?? null
      });
    }

    await repository.updateOperation(decision.operationId!, { avgSatisfaction: decision.value! });

    // 담당 OM 과 다른 사람이 눌렀는지 알린다 — 막지는 않는다(휴가·대리 반영이 실제로 있다).
    const operation = operations.find((item) => item.id === decision.operationId);
    const submitter = (body.manager ?? "").trim().toLowerCase();
    const ownerText = `${operation?.om ?? ""} ${operation?.onsiteOm ?? ""}`.trim();
    const byOther =
      submitter !== "" && ownerText !== "" && !ownerText.toLowerCase().includes(submitter.split("@")[0]);

    console.info(
      `[satisfaction:round-apply] by=${body.manager ?? "unknown"} operationId=${decision.operationId} ` +
        `value=${decision.value} previous=${decision.previous ?? "(빈칸)"} recordId=${row.recordId}`
    );

    return NextResponse.json({
      ok: true,
      applied: true,
      status: decision.status,
      message: decision.message,
      operation: decision.operationLabel ?? null,
      value: decision.value,
      previous: decision.previous ?? null,
      owner: ownerText || null,
      byOther
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "반영 중 오류가 났습니다." },
      { status: 500 }
    );
  }
}
