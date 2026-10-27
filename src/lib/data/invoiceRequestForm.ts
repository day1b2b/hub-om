import { INVOICE_REQUEST_FORM_URL } from "./invoiceRequestFormSchema";

/** entry ID는 invoiceRequestFormSchema.ts의 스냅샷과 같은 값이어야 한다. */
const ENTRY = {
  courseId: 1605874017,
  courseName: 37795259,
  studentName: 839876938,
  businessNumber: 884272204,
  companyName: 1963784111,
  representativeName: 781780645,
  address: 1112129156,
  businessType: 1210846276,
  businessItem: 1151731824,
  invoiceEmail: 629095236,
  invoiceEmailSecondary: 156848977,
  businessUnit: 1562098117
} as const;

/** 하이픈/공백 제거. 사업자번호는 폼에서 "- 없이" 받는다. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export interface InvoiceRequestFormInput {
  courseId?: string | null;
  courseName?: string | null;
  companyName?: string | null;
  businessNumber?: string | null;
  representativeName?: string | null;
  address?: string | null;
  businessType?: string | null;
  businessItem?: string | null;
  invoiceEmail?: string | null;
  invoiceEmailSecondary?: string | null;
}

/**
 * 계산서 발행 요청 구글폼 prefill 링크를 만든다. 값이 없는 항목은 아예 쿼리에 넣지 않는다
 * (빈 문자열로 억지로 채우지 않음 — 사람이 직접 보고 입력해야 하는 항목과 구분하기 위해서다).
 *
 * 금액(총금액/공급가액/부가세), 청구/영수, 입금예정일, 담당자, 수강생이름의 "실제 값"은
 * 운영 데이터로 자동 판단할 수 없어 비워 둔다. 수강생이름만 예외로 기업명을 그대로 채운다.
 */
export function buildInvoiceRequestFormUrl(input: InvoiceRequestFormInput): string {
  const params = new URLSearchParams();
  const set = (entryId: number, value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) params.set(`entry.${entryId}`, trimmed);
  };

  set(ENTRY.courseId, input.courseId);
  set(ENTRY.courseName, input.courseName);
  set(ENTRY.studentName, input.companyName); // 수강생이름 = 기업명
  set(ENTRY.businessNumber, input.businessNumber ? digitsOnly(input.businessNumber) : input.businessNumber);
  set(ENTRY.companyName, input.companyName);
  set(ENTRY.representativeName, input.representativeName);
  set(ENTRY.address, input.address);
  set(ENTRY.businessType, input.businessType);
  set(ENTRY.businessItem, input.businessItem);
  set(ENTRY.invoiceEmail, input.invoiceEmail);
  set(ENTRY.invoiceEmailSecondary, input.invoiceEmailSecondary);
  params.set(`entry.${ENTRY.businessUnit}`, "데이원B2B");

  const query = params.toString();
  return query ? `${INVOICE_REQUEST_FORM_URL}?${query}` : INVOICE_REQUEST_FORM_URL;
}
