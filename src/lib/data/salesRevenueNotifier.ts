import { listTeamUsers } from "./teamUsers/teamUserRepository";
import { sendSlackDirectMessage } from "../slack/notifySlack";

export async function notifySalesSyncFailure(text: string): Promise<void> {
  const raw = process.env.SALES_SYNC_ALERT_EMAILS?.trim();
  if (!raw) return;
  const targets = raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (targets.length === 0) return;

  try {
    const users = await listTeamUsers();
    for (const email of targets) {
      const user = users.find((candidate) => candidate.email?.trim().toLowerCase() === email);
      if (user?.slackId) {
        await sendSlackDirectMessage(user.slackId, text);
      }
    }
  } catch {
    // 알림 실패는 조용히 넘어간다 — 동기화 결과 자체를 가리면 안 된다.
  }
}
