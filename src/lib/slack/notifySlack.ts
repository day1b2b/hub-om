async function postToSlack(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

const EMAIL_TO_SLACK_ID: Record<string, string> = {
  "othilia.kim@day1company.co.kr": "U096JU3U3CK",
};

export async function notifyOmRequestCreated(params: {
  team: string;
  ld: string;
  ldEmail?: string;
  company: string;
  trainingType: string;
  courseName: string;
  syncupLink: string;
  skillfloSetup: string;
  onSiteOperation: string;
  coachRequest: string;
  totalSessions: number;
  sessions: { date: string; timeStart: string; timeEnd: string; location: string }[];
  notes: string;
}) {
  const sessionLines = params.sessions
    .map((s, i) => {
      const duration = s.duration ? (s.duration.endsWith("h") ? s.duration : `${s.duration}h`) : "";
      return `• ${i + 1}회차 / ${s.date} / ${s.timeStart} ~ ${s.timeEnd}${duration ? ` / ${duration}` : ""} / ${s.location}`;
    })
    .join("\n");

  const TEAM_MENTIONS: Record<string, string> = {
    "2팀": "<@U096JU3U3CK>",
  };
  const mention = TEAM_MENTIONS[params.team] ? ` ${TEAM_MENTIONS[params.team]}` : "";
  const ldSlackId = params.ldEmail ? EMAIL_TO_SLACK_ID[params.ldEmail] : undefined;
  const ldDisplay = ldSlackId ? `<@${ldSlackId}>` : params.ld;

  await postToSlack(
    `:clipboard: *운영 요청이 접수되었습니다.*${mention}\n` +
    `*1. 구분*\n${params.team}\n` +
    `*2. LD*\n${ldDisplay}\n` +
    `*3. 기업명*\n${params.company}\n` +
    `*4. 교육형태*\n${params.trainingType}\n` +
    `*5. 과정명*\n${params.courseName}\n` +
    `*6. 싱크업 링크*\n${params.syncupLink}\n` +
    `*7. 세팅*\n스킬플로: ${params.skillfloSetup} / 현장운영: ${params.onSiteOperation} / 코치 요청: ${params.coachRequest}\n` +
    `*8. 총 회차*\n${params.totalSessions}회\n` +
    `*9. 일정*\n${sessionLines}\n` +
    `*10. 요청사항*\n${params.notes}`
  );
}

export async function notifyOmAssigned(params: {
  company: string;
  courseName: string;
  assignedOm: string;
}) {
  await postToSlack(
    `✅ *담당자가 배정됐습니다*\n` +
    `기업: ${params.company}\n` +
    `과정: ${params.courseName}\n` +
    `담당 OM: ${params.assignedOm}`
  );
}
