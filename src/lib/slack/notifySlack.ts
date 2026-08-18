import { omRequestManagerName } from "@/lib/data/omRequest/omRequestTypes";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";

const SLACK_POST_URL = "https://slack.com/api/chat.postMessage";

function botToken(): string | undefined {
  return process.env.SLACK_OM_BOT_TOKEN?.trim() || undefined;
}

// 요청자 파트 → 알림 채널(env). 미설정 파트는 기본 채널로 폴백.
function resolvePartChannel(team: string): string | undefined {
  const byPart: Array<[string, string | undefined]> = [
    ["1파트", process.env.SLACK_OM_CHANNEL_1PART],
    ["2파트", process.env.SLACK_OM_CHANNEL_2PART],
    ["3파트", process.env.SLACK_OM_CHANNEL_3PART],
  ];
  for (const [key, value] of byPart) {
    if (team.includes(key) && value?.trim()) return value.trim();
  }
  return process.env.SLACK_OM_CHANNEL_DEFAULT?.trim() || undefined;
}

// 봇으로 채널/스레드에 전송. 성공 시 {channel, ts}. 토큰·채널 없거나 실패 시 null.
async function postViaBot(
  channel: string,
  text: string,
  threadTs?: string
): Promise<{ channel: string; ts: string } | null> {
  const token = botToken();
  if (!token || !channel) return null;
  try {
    const res = await fetch(SLACK_POST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel,
        text,
        thread_ts: threadTs,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; ts?: string; channel?: string; error?: string }
      | null;
    if (!data?.ok || !data.ts) {
      console.error("[slack] chat.postMessage 실패:", data?.error ?? "unknown");
      return null;
    }
    return { channel: data.channel ?? channel, ts: data.ts };
  } catch (error) {
    console.error("[slack] chat.postMessage 예외:", error);
    return null;
  }
}

// 봇 토큰 미설정 시 폴백. 웹훅은 스레드/멘션ID를 지원하지 않는다.
async function postViaWebhook(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    console.error("[slack] webhook 예외:", error);
  }
}

interface ResolvedTags {
  ldMention?: string;
  ldName?: string;
  omMention?: string;
  omName: string | null;
}

// 멤버관리(TeamUser)에서 LD(이메일)·OM장(파트 기준 이름)의 슬랙ID를 찾아 멘션 문자열로 변환.
async function resolveTags(team: string, ldEmail?: string): Promise<ResolvedTags> {
  let members: Awaited<ReturnType<typeof listTeamUsers>> = [];
  try {
    members = await listTeamUsers();
  } catch (error) {
    console.error("[slack] 멤버 조회 실패:", error);
  }
  const norm = (v?: string) => (v ?? "").trim().toLowerCase();
  const ld = ldEmail ? members.find((m) => norm(m.email) === norm(ldEmail)) : undefined;
  const omName = omRequestManagerName(team);
  const om = omName ? members.find((m) => m.name.trim() === omName.trim()) : undefined;
  return {
    ldMention: ld?.slackId ? `<@${ld.slackId}>` : undefined,
    ldName: ld?.name,
    omMention: om?.slackId ? `<@${om.slackId}>` : undefined,
    omName,
  };
}

// 이름으로 멤버 슬랙ID를 찾아 멘션 문자열로. 못 찾으면 이름 그대로.
async function mentionByName(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) return "";
  try {
    const members = await listTeamUsers();
    const found = members.find((m) => m.name.trim() === trimmed);
    if (found?.slackId) return `<@${found.slackId}>`;
  } catch (error) {
    console.error("[slack] 멤버 조회 실패:", error);
  }
  return trimmed;
}

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
  sessions: {
    date: string;
    dateEnd?: string;
    timeStart: string;
    timeEnd: string;
    duration: string;
    location: string;
  }[];
  notes: string;
}): Promise<{ channel: string; ts: string } | null> {
  const sessionLines = params.sessions
    .map((s, i) => {
      const duration = s.duration ? (s.duration.endsWith("h") ? s.duration : `${s.duration}h`) : "";
      const dateRange = s.dateEnd ? `${s.date} ~ ${s.dateEnd}` : s.date;
      return `• ${i + 1}회차 / ${dateRange} / ${s.timeStart} ~ ${s.timeEnd}${duration ? ` / ${duration}` : ""} / ${s.location}`;
    })
    .join("\n");

  const tags = await resolveTags(params.team, params.ldEmail);
  const tagLine = [tags.ldMention, tags.omMention].filter(Boolean).join(" ");
  const ldDisplay = tags.ldMention ?? tags.ldName ?? params.ld;

  const text =
    `:clipboard: *운영 요청이 접수되었습니다.*${tagLine ? `\n${tagLine} 확인 부탁드려요.` : ""}\n` +
    `*1. 구분*\n${params.team}\n` +
    `*2. LD*\n${ldDisplay}\n` +
    `*3. 기업명*\n${params.company}\n` +
    `*4. 교육형태*\n${params.trainingType}\n` +
    `*5. 과정명*\n${params.courseName}\n` +
    `*6. 싱크업 링크*\n${params.syncupLink}\n` +
    `*7. 세팅*\n스킬플로: ${params.skillfloSetup} / 현장운영: ${params.onSiteOperation} / 코치 요청: ${params.coachRequest}\n` +
    `*8. 총 회차*\n${params.totalSessions}회\n` +
    `*9. 일정*\n${sessionLines}\n` +
    `*10. 요청사항*\n${params.notes}`;

  const channel = resolvePartChannel(params.team);
  if (channel) {
    const posted = await postViaBot(channel, text);
    if (posted) return posted;
  }
  // 봇 토큰/채널 미설정 시 기존 웹훅으로라도 알림(스레드 없음).
  await postViaWebhook(text);
  return null;
}

export async function notifyOmAssigned(params: {
  team: string;
  company: string;
  courseName: string;
  assignedOm: string;
  ldEmail?: string;
  slackChannel?: string;
  slackThreadTs?: string;
}): Promise<void> {
  const omMention = await mentionByName(params.assignedOm);
  const tags = await resolveTags(params.team, params.ldEmail);
  const ldLine = tags.ldMention ?? tags.ldName;

  const text =
    `:white_check_mark: *OM 담당자가 배정되었습니다.*\n` +
    `*담당 OM*\n${omMention}\n` +
    (ldLine ? `*LD*\n${ldLine}\n` : "") +
    `*기업/과정*\n${params.company} / ${params.courseName}`;

  // 원 알림 스레드가 있으면 그 스레드에 댓글로. 없으면 파트 채널에 새 메시지.
  if (params.slackChannel && params.slackThreadTs) {
    const replied = await postViaBot(params.slackChannel, text, params.slackThreadTs);
    if (replied) return;
  }
  const channel = resolvePartChannel(params.team);
  if (channel) {
    const posted = await postViaBot(channel, text);
    if (posted) return;
  }
  await postViaWebhook(text);
}
