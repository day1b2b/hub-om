/**
 * "2025_계산서 발급 신청 내역" 구글폼의 질문 스냅샷(2026-10-16, 라이브 폼에서 추출).
 *
 * 구글폼은 외부에서 질문이 추가/삭제/변경될 수 있고, 그러면 entry ID 매핑이 조용히 깨진다.
 * `scripts/check-invoice-form-schema.mjs`가 라이브 폼을 다시 읽어 이 스냅샷과 비교한다 —
 * 폼이 바뀌었으면 이 파일과 `invoiceRequestForm.ts`의 entry ID도 같이 갱신해야 한다.
 */
export const INVOICE_REQUEST_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfE26Lq0dt0QoxkRW4Ge82PkTf3HGKGwVsAmA2AH-aozv8_iQ/viewform";

export interface InvoiceRequestFormQuestion {
  /** 질문 제목 앞부분(설명/안내 문구 전부는 생략, 변경 감지에 충분한 만큼만). */
  title: string;
  entryId: number;
}

export const INVOICE_REQUEST_FORM_SNAPSHOT: InvoiceRequestFormQuestion[] = [
  { title: "사업자 구분", entryId: 308154030 },
  { title: "사업(조직)부문 구분", entryId: 1562098117 },
  { title: "코스ID", entryId: 1605874017 },
  { title: "과정명", entryId: 37795259 },
  { title: "수강생이름", entryId: 839876938 },
  { title: "사업자번호", entryId: 884272204 },
  { title: "회사명", entryId: 1963784111 },
  { title: "대표자", entryId: 781780645 },
  { title: "주소", entryId: 1112129156 },
  { title: "업태", entryId: 1210846276 },
  { title: "종목", entryId: 1151731824 },
  { title: "계산서 발송 받을 이메일 주소 (1)", entryId: 629095236 },
  { title: "계산서 발송 받을 이메일 주소 (2)", entryId: 156848977 },
  { title: "면세 & 과세 선택", entryId: 1893042045 },
  { title: "총 금액 (입금예정금액)", entryId: 1387135918 },
  { title: "공급가액", entryId: 1175212411 },
  { title: "부가세", entryId: 1668281095 },
  { title: "청구/영수", entryId: 346742890 },
  { title: "입금(예정)일", entryId: 323340323 },
  { title: "담당자 (설문 제출자 성함_업체즉 담당자 성함 아님)", entryId: 26939183 }
];
