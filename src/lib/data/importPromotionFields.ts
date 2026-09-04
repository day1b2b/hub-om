/**
 * 반영(promote)에 반드시 필요한 필드. 라벨은 화면에 그대로 찍는다.
 *
 * 키는 파서가 정규화한 이름이다. 원천 시트 머리글이 "기업"·"고객사명"·"customer"처럼
 * 제각각이어도 importUploadParser가 여기로 맞춰 준다.
 */
const REQUIRED_FIELDS = [
  { key: "companyName", label: "기업명", date: false },
  { key: "courseName", label: "과정명", date: false },
  { key: "startDate", label: "시작일", date: true },
  { key: "endDate", label: "종료일", date: true }
] as const;

/** "2026-09-04" · "2026.9.4" · "2026/9/4"를 받아들인다. 못 읽으면 null. */
export function parsePromotionDate(value: string | undefined): Date | null {
  const normalized = (value ?? "").trim().replace(/[./]/g, "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 반영에 필요한데 비어 있는 필드의 라벨.
 *
 * 화면이 "과정 연결 필요"만 보여 줘서 무엇을 채워야 하는지 알 수 없었다. 이 목록으로
 * 문구에 이유를 붙인다.
 *
 * ★ 반드시 정규화된 전체 필드(mappedFields 원본 객체)로 판단해야 한다. 화면에 내려가는
 * 미리보기는 앞 12개만 잘라 담기 때문에, 그것으로 판단하면 기업명이 13번째에 있는 행이
 * "기업명 없음"으로 잘못 표시된다. 원천 파일에는 값이 있는데도 공란으로 보이던 원인이다.
 */
export function missingPromotionFields(fields: Record<string, string | undefined>): string[] {
  const missing: string[] = [];

  for (const required of REQUIRED_FIELDS) {
    const value = (fields[required.key] ?? "").trim();

    if (!value || value === "-") {
      missing.push(required.label);
      continue;
    }

    if (required.date && !parsePromotionDate(value)) {
      missing.push(`${required.label}(형식 확인)`);
    }
  }

  return missing;
}
