export interface DuplicateEmailGroup {
  /** 표기를 맞춘 이메일(앞뒤 공백·대소문자 무시). */
  email: string;
  /** 그 이메일로 등록된 이름들. 조회에서 이기는 순서와는 무관하게 전부. */
  names: string[];
}

/**
 * 같은 이메일로 등록된 명단 행을 찾는다.
 *
 * 이메일 중복은 조용히 사람을 가린다. 명단 조회가 createdAt 내림차순이라 나중 행의 이름이
 * 이기고, 그 이름이 운영 현황 OM 표기와 다르면 그 사람 대시보드가 통째로 0건이 된다.
 * 실제로 이 일이 났고, 원인을 찾는 데 한참 걸렸다. 화면에서 바로 보이게 한다.
 *
 * DB에 unique 제약을 걸면 근본으로 막히지만, 기존 중복이 남아 있어 마이그레이션이 실패한다.
 * 이 목록으로 정리한 뒤에 제약을 거는 순서가 맞다.
 */
export function findDuplicateEmails(
  users: ReadonlyArray<{ email: string; name: string }>
): DuplicateEmailGroup[] {
  const byEmail = new Map<string, string[]>();

  for (const user of users) {
    const key = (user.email ?? "").trim().toLowerCase();
    if (!key) continue; // 이메일이 빈 행은 중복 판정 대상이 아니다.
    const names = byEmail.get(key);
    const name = (user.name ?? "").trim();
    if (names) names.push(name);
    else byEmail.set(key, [name]);
  }

  return [...byEmail.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([email, names]) => ({ email, names }))
    .sort((a, b) => a.email.localeCompare(b.email));
}
