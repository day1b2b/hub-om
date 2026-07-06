import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

const OM_REQUEST_SLACK_CHANNEL_ID = "C0BFDQGTV6J";

// 테스트 단계: 2팀만 매핑. 1팀(이현정) 이메일 확인 후 추가.
const TEAM_TAG_EMAILS: Partial<Record<string, string>> = {
  "2팀": "othilia.kim@day1company.co.kr"
};

interface SlackLookupResponse {
  ok: boolean;
  user?: { id: string };
}

export async function notifyOmRequestSubmitted(request: OmRequest, submitterEmail: string | undefined): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  try {
    const teamTagEmail = TEAM_TAG_EMAILS[request.team];
    const mentionEmails = [...new Set([submitterEmail, teamTagEmail].filter((email): email is string => Boolean(email)))];
    const mentionIds = (await Promise.all(mentionEmails.map((email) => lookupSlackUserId(token, email)))).filter(
      (id): id is string => Boolean(id)
    );

    const lines = [
      mentionIds.map((id) => `<@${id}>`).join(" "),
      `새 OM 배정 요청이 접수됐습니다.`,
      `팀: ${request.team} · 기업명: ${request.company} · 과정명: ${request.courseName}`,
      `제출자: ${request.ld}`
    ].filter(Boolean);

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ channel: OM_REQUEST_SLACK_CHANNEL_ID, text: lines.join("\n") })
    });
  } catch (error) {
    console.error("OM 배정 요청 Slack 알림 전송 실패", error);
  }
}

async function lookupSlackUserId(token: string, email: string): Promise<string | null> {
  try {
    const response = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = (await response.json()) as SlackLookupResponse;
    return payload.ok ? payload.user?.id ?? null : null;
  } catch (error) {
    console.error("Slack 사용자 조회 실패", error);
    return null;
  }
}
