// 코치 일정 입력 링크 안내 메일의 "최근 작성" 기록. 별도 테이블 없이 코치 개인정보 열람 감사 로그
// (coach_private_access_logs) 중 context가 link_mail인 행을 읽는다. 열람 기록을 남기는 쪽(piiReveal)과
// 같은 저장소(PostgreSQL)를 쓴다.
import { LINK_MAIL_CONTEXT, latestLinkMailPerCoach, type CoachLinkMailLogEntry } from "../coaches/coachLinkMail";
import { getPrismaClient } from "./prisma";

export async function listLatestCoachLinkMails(): Promise<CoachLinkMailLogEntry[]> {
  const rows = await getPrismaClient().coachPrivateAccessLog.findMany({
    where: { context: LINK_MAIL_CONTEXT },
    orderBy: { accessedAt: "desc" },
    select: { coachId: true, accessedAt: true, accessedByEmail: true },
    take: 5000
  });
  return latestLinkMailPerCoach(rows);
}
