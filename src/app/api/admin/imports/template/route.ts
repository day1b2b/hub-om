import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

const TEMPLATE_FILE_NAME = "운영현황_일괄등록_양식.xlsx";

const GUIDE_ROW = [
  "",
  "",
  "",
  "코스ID",
  "회차별 기입 필요 (총 회차X)",
  "",
  "",
  "",
  "오프라인/비대면/블랜디드 중 선택",
  "",
  "",
  "",
  "",
  "",
  "",
  "링크",
  "링크",
  "N/Y로 선택",
  "링크",
  "링크",
  "특이사항 칼럼에 노출",
  "메모 칼럼에 노출"
];

const HEADER_ROW = [
  "고객사명",
  "과정명",
  "싱크업",
  "과정ID",
  "회차",
  "시작일",
  "종료일",
  "교육시간",
  "운영형태",
  "담당OM",
  "담당LD",
  "강사",
  "실습코치",
  "장소",
  "현장투입",
  "구글드라이브",
  "강의관리",
  "결과보고서여부",
  "결과보고서링크",
  "패들렛링크",
  "특이사항",
  "업데이트사항"
];

export async function GET() {
  await requireWorkspaceSession();

  const worksheet = XLSX.utils.aoa_to_sheet([GUIDE_ROW, HEADER_ROW]);
  worksheet["!cols"] = HEADER_ROW.map(() => ({ wch: 16 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "운영현황_일괄등록");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(TEMPLATE_FILE_NAME)}`
    }
  });
}
