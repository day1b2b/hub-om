import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { parseGoogleSpreadsheetUrl, readGoogleSheetRows } from "@/lib/data/googleSheetsImport";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { matchSatisfactionRow, sheetValuesToRows } from "@/lib/data/satisfactionSheet";
import type { OperationCandidate } from "@/lib/data/coachImport/matchOperation";

export const dynamic = "force-dynamic";

/**
 * 만족도 집계 시트를 운영 세션에 매칭해보는 미리보기(드라이런).
 * DB에 아무것도 쓰지 않고, 매칭/모호/미매칭 결과만 반환한다.
 * 시트는 로그인한 사용자의 Google 권한으로 읽는다(데이터 검수 기능과 동일).
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
    const body = (await request.json()) as {
      spreadsheetUrl?: string;
      tabTitle?: string;
      headerRowNumber?: number;
    };

    const tabTitle = body.tabTitle?.trim();
    if (!tabTitle) {
      return NextResponse.json({ ok: false, error: "가져올 탭 이름을 입력해 주세요." }, { status: 400 });
    }

    const { spreadsheetId } = parseGoogleSpreadsheetUrl(body.spreadsheetUrl ?? "");
    const values = await readGoogleSheetRows(accessToken, spreadsheetId, tabTitle);
    const headerRowNumber =
      Number.isInteger(body.headerRowNumber) && (body.headerRowNumber ?? 0) > 0 ? Number(body.headerRowNumber) : 1;
    const sheetRows = sheetValuesToRows(values, headerRowNumber);

    const operations = await getOperationRepository().listOperations();
    const candidates: OperationCandidate[] = operations.map((operation) => ({
      id: operation.id,
      operationId: operation.operationId,
      companyName: operation.companyName,
      courseName: operation.courseName,
      startDate: operation.startDate,
      endDate: operation.endDate,
      coachText: operation.coach,
      instructorsText: operation.instructors
    }));

    const operationById = new Map(operations.map((operation) => [operation.id, operation]));
    const results = sheetRows.map((row) => matchSatisfactionRow(row, candidates));

    const matched = results
      .filter((result) => result.status === "matched")
      .map((result) => {
        const operation = result.operationId ? operationById.get(result.operationId) : undefined;
        return {
          course: result.row.course,
          instructor: result.row.instructor,
          date: result.row.date,
          overall: result.row.overall,
          posPct: result.row.posPct,
          respondents: result.row.respondents,
          operationId: operation?.operationId ?? "",
          operationCourse: operation?.courseName ?? "",
          operationCompany: operation?.companyName ?? "",
          operationDates: operation ? `${operation.startDate}~${operation.endDate}` : "",
          currentSatisfaction: operation?.avgSatisfaction ?? "",
          score: result.ranked[0]?.score ?? 0
        };
      });

    const ambiguous = results
      .filter((result) => result.status === "ambiguous")
      .map((result) => ({
        course: result.row.course,
        instructor: result.row.instructor,
        date: result.row.date,
        candidates: result.ranked.slice(0, 3).map((entry) => ({
          courseName: entry.candidate.courseName,
          company: entry.candidate.companyName ?? "",
          dates: `${entry.candidate.startDate}~${entry.candidate.endDate}`,
          score: entry.score
        }))
      }));

    const unmatched = results
      .filter((result) => result.status === "unmatched")
      .map((result) => ({
        course: result.row.course,
        instructor: result.row.instructor,
        date: result.row.date,
        courseId: result.row.courseId
      }));

    return NextResponse.json({
      ok: true,
      stats: {
        total: results.length,
        matched: matched.length,
        ambiguous: ambiguous.length,
        unmatched: unmatched.length,
        operations: operations.length
      },
      matched,
      ambiguous,
      unmatched
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "미리보기 생성 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
