// 기업명 입력 규칙. 업무 요청·과정 작성·운영 상세(기업명 변경)가 같은 규칙을 쓴다 — 화면과 API 둘 다에서 확인한다.
// 기업명은 표기(정규화 기준)로 같은 기업을 찾기 때문에, "도레이첨단소재 주식회사"/"도레이첨단소재주식회사"처럼
// 띄어쓰기만 다른 이름이 서로 다른 기업으로 갈라지지 않게 공백을 아예 받지 않는다.

/** 기업명 입력이 규칙에 맞지 않으면 화면에 보여줄 문구, 맞으면 null. */
export function companyNameError(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "기업명을 입력해 주세요.";
  if (/\s/.test(value.trim())) return "기업명에는 띄어쓰기를 넣을 수 없습니다. 예: 도레이첨단소재주식회사";
  return null;
}
