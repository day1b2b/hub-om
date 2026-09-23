export const OPERATION_CREATE_TEMPLATE_HEADER = [
  "회차", "시작일", "종료일", "시간", "강사", "실습코치", "지역", "실제교육일(선택)"
];

export const OPERATION_CREATE_TEMPLATE_SAMPLE_ROW = [
  "1", "2026-09-03", "2026-09-07", "09:30 ~ 17:30", "강사A", "코치A", "",
  "2026-09-03, 2026-09-04, 2026-09-07"
];

export function buildOperationCreateTemplateCsv(): string {
  return [OPERATION_CREATE_TEMPLATE_HEADER, OPERATION_CREATE_TEMPLATE_SAMPLE_ROW]
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
}
