// 노션 페이지 링크 파싱(순수 — DB/저장소 import 없음, 단위 테스트 용이).
/** 노션 페이지 URL/ID에서 32자리 hex 페이지 ID를 뽑는다. 없으면 null(=잘못된 링크). */
export function parseNotionPageId(linkOrId: string): string | null {
  const hex = String(linkOrId).replace(/-/g, "").match(/[0-9a-f]{32}/i);
  return hex ? hex[0].toLowerCase() : null;
}
