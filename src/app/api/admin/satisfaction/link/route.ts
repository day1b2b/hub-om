import { NextResponse } from "next/server";
import { authorizeSatisfactionMatching } from "@/lib/auth/satisfactionMatchingAccess";
import { parseGoogleSpreadsheetUrl, readGoogleSheetRows } from "@/lib/data/googleSheetsImport";
import { getGoogleB2BAccessToken } from "@/lib/googleCalendar/calendarWriteClient";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { planSatisfactionApply } from "@/lib/data/satisfactionApplyPlan";
import { sheetValuesToRows, type SatisfactionMatchResult } from "@/lib/data/satisfactionSheet";

export const dynamic = "force-dynamic";

/**
 * 모호(ambiguous) 건을 사람이 직접 고른 운영 회차에 수동 연결한다.
 *
 * 안전 규칙 (docs/operations/db-write-safety.md, 자동 반영과 동일):
 *   - 사람이 후보 중 하나를 명시적으로 선택했을 때만 실행한다(행별 버튼 클릭).
 *   - 자동 반영과 같은 계획 함수(planSatisfactionApply)를 재사용한다:
 *     시트 만족도 값이 있어야 하고, 대상 회차가 비어 있을 때만 채운다.
 *     ★이미 값이 있는 회차는 건드리지 않는다(사람이 넣은 값 보호).
 *   - 물리 삭제·스키마 변경 없음. 수정 필드는 avgSatisfaction 하나뿐.
 */
export async function POST(request: Request) {
  const access = await authorizeSatisfactionMatching();
  if (!access.ok) return access.response;
  const { session } = access;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      recordId?: string;
      operationId?: string;
      spreadsheetUrl?: string;
      tabTitle?: string;
      headerRowNumber?: number;
    };

    const recordId = body.recordId?.trim() ?? "";
    const operationId = body.operationId?.trim() ?? "";
    if (!recordId) {
      return NextResponse.json({ ok: false, error: "연결할 시트 행(record_id)이 없어요." }, { status: 400 });
    }
    if (!operationId) {
      return NextResponse.json({ ok: false, error: "연결할 운영을 선택해 주세요." }, { status: 400 });
    }

    const tabTitle = body.tabTitle?.trim() || process.env.SATISFACTION_SHEET_TAB?.trim() || "eduops_log";
    const sheetUrl = body.spreadsheetUrl?.trim() || process.env.SATISFACTION_SHEET_URL?.trim() || "";
    if (!sheetUrl) {
      return NextResponse.json(
        { ok: false, error: "시트 주소가 없어요. 서버 설정(SATISFACTION_SHEET_URL)을 확인해 주세요." },
        { status: 400 }
      );
    }

    const { spreadsheetId } = parseGoogleSpreadsheetUrl(sheetUrl);
    // 개별 사용자 권한이 아니라 전용 B2B 구글 계정(캘린더 OAuth와 공용)으로 시트를 읽는다.
    const accessToken = await getGoogleB2BAccessToken();
    const values = await readGoogleSheetRows(accessToken, spreadsheetId, tabTitle);
    const headerRowNumber =
      Number.isInteger(body.headerRowNumber) && (body.headerRowNumber ?? 0) > 0 ? Number(body.headerRowNumber) : 1;
    const sheetRows = sheetValuesToRows(values, headerRowNumber);

    const row = sheetRows.find((candidate) => candidate.recordId === recordId);
    if (!row) {
      return NextResponse.json(
        { ok: false, error: "시트에서 해당 행을 찾지 못했어요. 새로고침 후 다시 시도해 주세요." },
        { status: 404 }
      );
    }

    const repository = getOperationRepository();
    const operations = await repository.listOperations();
    const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
    if (!operationsById.has(operationId)) {
      return NextResponse.json({ ok: false, error: "선택한 운영을 찾지 못했어요." }, { status: 404 });
    }

    // 사람이 고른 운영으로 "강제 matched" 결과를 만들어, 자동 반영과 동일한 계획·안전 규칙에 태운다.
    const forced: SatisfactionMatchResult = { row, status: "matched", operationId, ranked: [] };
    const plan = planSatisfactionApply([forced], operationsById);

    const applied: Array<{ operation: string; value: string }> = [];
    const failed: Array<{ error: string }> = [];

    for (const item of plan.apply) {
      try {
        await repository.updateOperation(item.operationId, { avgSatisfaction: item.value });
        applied.push({ operation: item.label, value: item.value });
        console.info(
          `[satisfaction:link] by=${session.user?.email ?? "unknown"} operationId=${item.operationId} value=${item.value} recordId=${item.recordId}`
        );
      } catch (error) {
        failed.push({ error: error instanceof Error ? error.message : "연결 실패" });
      }
    }

    const skipped = [...plan.skip, ...plan.missing];

    return NextResponse.json({ ok: true, applied, skipped, failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "연결 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
