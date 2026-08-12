import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseGoogleSpreadsheetUrl, readGoogleSheetRows } from "@/lib/data/googleSheetsImport";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { planSatisfactionApply } from "@/lib/data/satisfactionApplyPlan";
import { matchSatisfactionRow, sheetValuesToRows } from "@/lib/data/satisfactionSheet";
import type { OperationCandidate } from "@/lib/data/operationMatch/matchOperation";

export const dynamic = "force-dynamic";

/**
 * 만족도 집계 시트의 '자동연결(matched)' 건을 운영 세션 만족도에 기록한다.
 *
 * 안전 규칙 (docs/operations/db-write-safety.md):
 *   - 데이터 책임자 승인·백업 확인 후 도입된 기능이다(2026-08-10).
 *   - 버튼 클릭으로만 실행한다(자동 배치 없음).
 *   - matched만 쓴다. 모호(ambiguous)·미매칭(unmatched)은 절대 쓰지 않는다.
 *   - ★이미 값이 있는 회차는 건드리지 않는다. 비어 있는 회차만 채운다.
 *     (사람이 직접 넣은 값이 시트 값에 덮이는 사고를 원천 차단)
 *   - 물리 삭제·스키마 변경 없음. 수정 필드는 avgSatisfaction 하나뿐.
 */
export async function POST(request: Request) {
  const session = await requireWorkspaceSession();
  const accessToken = session.googleAccessToken;

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "Google 스프레드시트 읽기 권한이 필요합니다.", reauthRequired: true },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      spreadsheetUrl?: string;
      tabTitle?: string;
      headerRowNumber?: number;
    };

    const tabTitle = body.tabTitle?.trim() || process.env.SATISFACTION_SHEET_TAB?.trim() || "eduops_log";
    const sheetUrl = body.spreadsheetUrl?.trim() || process.env.SATISFACTION_SHEET_URL?.trim() || "";
    if (!sheetUrl) {
      return NextResponse.json(
        { ok: false, error: "시트 주소가 없어요. 서버 설정(SATISFACTION_SHEET_URL)을 확인해 주세요." },
        { status: 400 }
      );
    }

    const { spreadsheetId } = parseGoogleSpreadsheetUrl(sheetUrl);
    const values = await readGoogleSheetRows(accessToken, spreadsheetId, tabTitle);
    const headerRowNumber =
      Number.isInteger(body.headerRowNumber) && (body.headerRowNumber ?? 0) > 0 ? Number(body.headerRowNumber) : 1;
    const sheetRows = sheetValuesToRows(values, headerRowNumber);

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

    // 매칭 → "무엇을 쓸지" 결정은 순수 함수(planSatisfactionApply)에 위임한다.
    // 안전 규칙(matched만·빈 값 제외·기존 값 보존)이 테스트로 고정된 한 곳에서만 판단된다.
    const results = sheetRows.map((row) => matchSatisfactionRow(row, candidates));
    const plan = planSatisfactionApply(
      results,
      new Map(operations.map((operation) => [operation.id, operation]))
    );

    const applied: Array<{ course: string; date: string; overall: string; operation: string }> = [];
    const failed: Array<{ course: string; date: string; error: string }> = [];

    for (const item of plan.apply) {
      try {
        await repository.updateOperation(item.operationId, { avgSatisfaction: item.value });
        applied.push({ course: item.course, date: item.date, overall: item.value, operation: item.label });
        console.info(
          `[satisfaction:apply] by=${session.user?.email ?? "unknown"} operationId=${item.operationId} value=${item.value} recordId=${item.recordId}`
        );
      } catch (error) {
        failed.push({
          course: item.course,
          date: item.date,
          error: error instanceof Error ? error.message : "반영 실패"
        });
      }
    }

    const skipped = [...plan.skip, ...plan.missing];

    return NextResponse.json({
      ok: true,
      stats: { applied: applied.length, skipped: skipped.length, failed: failed.length },
      applied,
      skipped,
      failed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "반영 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
