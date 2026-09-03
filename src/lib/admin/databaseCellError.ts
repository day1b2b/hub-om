import type { AdminDatabaseTableKey } from "./databaseEditConfig";

/** Prisma 오류에서 code를 꺼낸다. 타입 import 없이 모양만 확인한다(테스트에서 흉내내기 쉽게). */
export function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * 받침 유무로 조사를 고른다. "기업이 있습니다" / "멤버가 있습니다"처럼 맞춘다.
 * 한글 음절은 (코드 - 0xAC00) % 28 이 0이 아니면 받침이 있다.
 */
function withParticle(word: string, withJong: string, withoutJong: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) {
    // 한글이 아니면(영문·숫자) 판단 근거가 없다. 눈에 덜 거슬리는 쪽을 쓴다.
    return `${word}${withoutJong}`;
  }
  return `${word}${(code - 0xac00) % 28 !== 0 ? withJong : withoutJong}`;
}

/** 표에 쓰는 사람이 읽는 이름. */
const TABLE_LABELS: Record<AdminDatabaseTableKey, string> = {
  companies: "기업",
  courses: "과정",
  members: "멤버",
  operation_sessions: "운영 회차"
};

/**
 * DB 조회 화면의 셀 저장 실패를 사람이 읽을 수 있는 문장으로 바꾼다.
 *
 * 전에는 무슨 오류든 "저장하지 못했습니다."만 떴다. 기업명을 이미 있는 기업 이름으로
 * 바꾸려다 유니크 제약에 걸린 경우가 실제로 있었는데, 왜 막혔는지 알 수 없어
 * 원인을 찾는 데 시간이 걸렸다.
 *
 * 기업·멤버는 이름을 바꿀 때 정규화명(@unique)도 함께 바뀐다. 그래서 같은 이름이 이미
 * 있으면 저장이 거부된다 — 이름만 바꿔서 두 행을 합칠 수는 없다는 뜻이고, 그걸 문장으로
 * 알려 준다. 합치려면 과정을 옮겨야 하는데 그건 별개 작업이다.
 */
export function describeCellUpdateError(input: {
  code: string | null;
  table: AdminDatabaseTableKey;
  field: string;
  label: string;
  value: string;
}): string {
  const tableLabel = TABLE_LABELS[input.table] ?? "행";

  if (input.code === "P2002") {
    const isNameMerge = input.field === "name" && (input.table === "companies" || input.table === "members");
    if (isNameMerge) {
      return `이미 "${input.value}" ${withParticle(tableLabel, "이", "가")} 있습니다. 이름을 바꿔서 두 ${withParticle(tableLabel, "을", "를")} 합칠 수는 없습니다 — 연결된 과정을 옮겨야 하는 별개 작업입니다.`;
    }
    return `이미 같은 값을 쓰는 ${withParticle(tableLabel, "이", "가")} 있습니다. ${withParticle(input.label, "은", "는")} 중복될 수 없습니다.`;
  }

  if (input.code === "P2025") {
    return `이 ${withParticle(tableLabel, "을", "를")} 찾을 수 없습니다. 다른 사람이 지웠을 수 있으니 새로고침 후 다시 시도해 주세요.`;
  }

  if (input.code === "P2003") {
    return `다른 데이터가 이 값을 참조하고 있어 바꿀 수 없습니다.`;
  }

  return `저장하지 못했습니다. ${input.label} 값을 확인해 주세요.`;
}
