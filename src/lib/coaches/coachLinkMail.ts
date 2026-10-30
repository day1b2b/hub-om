// 코치 일정 입력 링크 안내 메일. hub는 메일을 보내지 않고, 받는 사람·제목·본문을 채운 Gmail 작성창 주소만 만든다.
// 실제 발송은 버튼을 누른 OM이 자기 계정 Gmail에서 한다. 문구는 외부 안내문 톤(짧은 긍정 지시)으로 합의된 초안이다.

/** coach_private_access_logs.context 값. 이메일 열람 기록이면서 "안내 메일 작성창을 열었다"는 기록이다. */
export const LINK_MAIL_CONTEXT = "link_mail";

export const LINK_MAIL_SUBJECT = "[데이원컴퍼니] 코치님 일정 입력 링크 안내";

export function buildCoachLinkMailBody(coachName: string, link: string): string {
  return [
    `안녕하세요, ${coachName} 코치님.`,
    "데이원컴퍼니 B2B 운영팀입니다.",
    "",
    "코치님 전용 일정 입력 링크를 보내드려요 :)",
    "가능한 날짜와 시간을 편하실 때 입력해 주세요.",
    "",
    link,
    "",
    "· 코치님만 쓰시는 개인 링크예요.",
    "· 언제든 다시 들어와 고치실 수 있어요.",
    "",
    "감사합니다 :)"
  ].join("\n");
}

export function buildCoachLinkMailUrl({ to, coachName, link }: { to: string; coachName: string; link: string }): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to,
    su: LINK_MAIL_SUBJECT,
    body: buildCoachLinkMailBody(coachName, link)
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export interface CoachLinkMailLogEntry {
  coachId: string;
  at: string;
  byEmail: string | null;
}

/** 코치별 가장 최근 기록 1건만 남긴다(rows는 최신순으로 정렬돼 있어야 한다). */
export function latestLinkMailPerCoach(
  rows: Array<{ coachId: string; accessedAt: Date; accessedByEmail: string | null }>
): CoachLinkMailLogEntry[] {
  const seen = new Set<string>();
  const result: CoachLinkMailLogEntry[] = [];
  for (const row of rows) {
    if (seen.has(row.coachId)) continue;
    seen.add(row.coachId);
    result.push({ coachId: row.coachId, at: row.accessedAt.toISOString(), byEmail: row.accessedByEmail });
  }
  return result;
}

/** 감사 로그의 이메일에서 화면 표시용 짧은 이름(앞부분)만 남긴다. */
export function shortActorName(email: string | null | undefined): string {
  if (!email) return "-";
  const local = email.split("@")[0];
  return local || "-";
}
