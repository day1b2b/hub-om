import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUser } from "@/lib/data/teamUsers/teamUserTypes";
import { omRequestManagerName } from "@/lib/data/omRequest/omRequestTypes";

// ── Slack 발송 방식 ────────────────────────────────────────────────
// 1순위: 봇 토큰(SLACK_BOT_TOKEN) + chat.postMessage.
//   - 파트별 채널로 라우팅하고, 발송한 메시지의 ts를 회수해 저장한다.
//   - 배정 시 그 ts로 같은 스레드에 댓글을 달아 OM·LD를 태깅한다.
// 2순위(폴백): 봇/채널 미설정 시 기존 SLACK_WEBHOOK_URL(단일 채널)로 발송.
//   - 웹훅은 스레드 댓글·ts 회수가 불가하므로 배정 알림은 별도 메시지가 된다.
//   - 봇 환경을 붙이기 전까지 기존 동작(2팀 등)을 깨지 않기 위한 안전망.

function botToken(): string {
  // 알림 전용 봇 토큰을 우선 사용한다. 미설정 시 기존 SLACK_BOT_TOKEN(논의 읽기와 공용)으로 폴백.
  // 알림 봇과 읽기 봇이 다른 앱일 때 서로 간섭하지 않도록 분리 가능하게 둔다.
  return (process.env.SLACK_OM_REQUEST_BOT_TOKEN?.trim() || process.env.SLACK_BOT_TOKEN?.trim()) ?? "";
}

// SLACK_OM_REQUEST_CHANNELS="1파트:C0AAA,2파트:C0BBB,3파트:C0CCC"
function resolveChannel(team: string): string {
  const raw = process.env.SLACK_OM_REQUEST_CHANNELS?.trim();
  if (!raw) return "";
  for (const entry of raw.split(",")) {
    const sep = entry.indexOf(":");
    if (sep === -1) continue;
    const key = entry.slice(0, sep).trim();
    const channel = entry.slice(sep + 1).trim();
    if (key && channel && team.includes(key)) return channel;
  }
  return "";
}

/** 봇으로 메시지 발송. 성공 시 { ts } 반환, 실패/미설정 시 null. */
async function botPost(channel: string, text: string, threadTs?: string): Promise<{ ts: string } | null> {
  const token = botToken();
  if (!token || !channel) return null;
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        unfurl_links: false,
      }),
    });
    const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    if (!data.ok) {
      console.error("[notifySlack] chat.postMessage 실패:", data.error);
      return null;
    }
    return { ts: data.ts ?? "" };
  } catch (err) {
    console.error("[notifySlack] chat.postMessage 예외:", err);
    return null;
  }
}

/** 폴백: 기존 Incoming Webhook 단일 채널 발송(스레드 불가). */
async function webhookPost(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[notifySlack] webhook 발송 예외:", err);
  }
}

// ── 멘션 해석 (teamUsers 디렉토리의 slackId 사용) ─────────────────────
function normalizeName(value: string): string {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

async function loadDirectory(): Promise<TeamUser[]> {
  try {
    return await listTeamUsers();
  } catch (err) {
    console.error("[notifySlack] 팀원 디렉토리 조회 실패:", err);
    return [];
  }
}

/** 이메일로 slackId 멘션. 못 찾으면 fallback 텍스트. */
function mentionByEmail(users: TeamUser[], email: string | undefined, fallback: string): string {
  if (email) {
    const key = email.trim().toLowerCase();
    const hit = users.find((u) => u.email?.trim().toLowerCase() === key);
    if (hit?.slackId) return `<@${hit.slackId}>`;
  }
  return fallback;
}

/** 이름으로 slackId 멘션. 못 찾으면 fallback 텍스트(대개 이름 그대로). */
function mentionByName(users: TeamUser[], name: string | undefined | null, fallback: string): string {
  if (name) {
    const key = normalizeName(name);
    const hit = users.find((u) => normalizeName(u.name) === key);
    if (hit?.slackId) return `<@${hit.slackId}>`;
  }
  return fallback;
}

// ── 요청 접수 알림 ────────────────────────────────────────────────
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
  sessions: { date: string; dateEnd?: string; timeStart: string; timeEnd: string; duration: string; location: string }[];
  notes: string;
}): Promise<{ channel: string; ts: string } | null> {
  const sessionLines = params.sessions
    .map((s, i) => {
      const duration = s.duration ? (s.duration.endsWith("h") ? s.duration : `${s.duration}h`) : "";
      const dateRange = s.dateEnd ? `${s.date} ~ ${s.dateEnd}` : s.date;
      return `• ${i + 1}회차 / ${dateRange} / ${s.timeStart} ~ ${s.timeEnd}${duration ? ` / ${duration}` : ""} / ${s.location}`;
    })
    .join("\n");

  const users = await loadDirectory();
  const ldMention = mentionByEmail(users, params.ldEmail, params.ld);
  const managerName = omRequestManagerName(params.team);
  const managerMention = managerName ? mentionByName(users, managerName, managerName) : "";
  const headerTags = [managerMention, ldMention].filter(Boolean).join(" ");

  const text =
    `:clipboard: *운영 요청이 접수되었습니다.*${headerTags ? ` ${headerTags}` : ""}\n` +
    `*1. 구분*\n${params.team}\n` +
    `*2. LD*\n${ldMention}\n` +
    `*3. 기업명*\n${params.company}\n` +
    `*4. 교육형태*\n${params.trainingType}\n` +
    `*5. 과정명*\n${params.courseName}\n` +
    `*6. 싱크업 링크*\n${params.syncupLink}\n` +
    `*7. 세팅*\n스킬플로: ${params.skillfloSetup} / 현장운영: ${params.onSiteOperation} / 코치 요청: ${params.coachRequest}\n` +
    `*8. 총 회차*\n${params.totalSessions}회\n` +
    `*9. 일정*\n${sessionLines}\n` +
    `*10. 요청사항*\n${params.notes}`;

  const channel = resolveChannel(params.team);
  if (botToken() && channel) {
    const posted = await botPost(channel, text);
    if (posted?.ts) return { channel, ts: posted.ts };
    return null;
  }

  // 봇/채널 미설정 → 기존 웹훅 폴백(스레드 저장 불가)
  await webhookPost(text);
  return null;
}

// ── 배정 완료 알림 (같은 스레드에 댓글로 태깅) ─────────────────────
export async function notifyOmAssigned(params: {
  company: string;
  courseName: string;
  assignedOm: string;
  ld?: string;
  ldEmail?: string;
  channel?: string;
  threadTs?: string;
}): Promise<void> {
  const users = await loadDirectory();
  const omMention = mentionByName(users, params.assignedOm, params.assignedOm);
  const ldMention = mentionByEmail(users, params.ldEmail, params.ld ?? "");
  const tags = [omMention, ldMention].filter(Boolean).join(" ");

  const text =
    `:white_check_mark: *OM이 배정됐습니다.*${tags ? ` ${tags}` : ""}\n` +
    `*기업* ${params.company}\n` +
    `*과정* ${params.courseName}\n` +
    `*담당 OM* ${omMention}`;

  // 원 알림 스레드가 있으면 그 스레드에 댓글로 발송
  if (botToken() && params.channel && params.threadTs) {
    const posted = await botPost(params.channel, text, params.threadTs);
    if (posted) return;
  }

  // 폴백: 스레드 정보가 없으면 기존 웹훅으로 단독 메시지
  await webhookPost(text);
}
