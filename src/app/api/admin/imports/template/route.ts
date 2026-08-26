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
  "멤버 관리에 등록된 이름과 동일하게 입력 (다르면 빈 값으로 반영됨)",
  "멤버 관리에 등록된 이름과 동일하게 입력 (다르면 빈 값으로 반영됨)",
  "강사DB 노션에 등록된 이름과 동일하게 입력 (다르면 반영이 보류돼요, 비워도 됨)",
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
  "코스ID",
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

const EXAMPLE_ROWS = [
  [
    "(예시) 스킬플로",
    "(예시) 생성형 AI 실무 활용 교육",
    "(예시) 싱크업 시트 링크를 붙여넣으세요",
    "123456",
    "1",
    "2026-01-05",
    "2026-01-06",
    "09:00~18:00",
    "오프라인",
    "(예시) 홍길동",
    "(예시) 김철수",
    "(예시) 이영희",
    "",
    "서울",
    "Y",
    "(예시) 구글드라이브 폴더 링크를 붙여넣으세요",
    "",
    "N",
    "",
    "",
    "",
    "(예시) 여기에 남기면 운영 상세의 메모란에 표시됩니다"
  ],
  [
    "(예시) 스킬플로",
    "(예시) 생성형 AI 실무 활용 교육",
    "(예시) 싱크업 시트 링크를 붙여넣으세요",
    "123456",
    "2",
    "2026-01-19",
    "2026-01-20",
    "09:00~18:00",
    "오프라인",
    "(예시) 홍길동",
    "(예시) 김철수",
    "(예시) 박민수",
    "",
    "서울",
    "Y",
    "(예시) 구글드라이브 폴더 링크를 붙여넣으세요",
    "",
    "N",
    "",
    "",
    "",
    ""
  ]
];

export async function GET() {
  await requireWorkspaceSession();

  const worksheet = XLSX.utils.aoa_to_sheet([GUIDE_ROW, HEADER_ROW, ...EXAMPLE_ROWS]);
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
