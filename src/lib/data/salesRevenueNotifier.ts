import { listTeamUsers } from "./teamUsers/teamUserRepository";
import { scheduleSlackDirectMessage, sendSlackDirectMessage } from "../slack/notifySlack";

/** SALES_SYNC_ALERT_EMAILS(쉼표구분)의 각 이메일을 teamUsers의 slackId로 풀어 send를 호출한다. 알림 실패는 조용히 넘어간다. */
async function notifyAlertTargets(send: (slackId: string) => Promise<unknown>): Promise<void> {
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
        await send(user.slackId);
      }
    }
  } catch {
    // 알림 실패는 조용히 넘어간다 — 동기화 결과 자체를 가리면 안 된다.
  }
}

export async function notifySalesSyncFailure(text: string): Promise<void> {
  await notifyAlertTargets((slackId) => sendSlackDirectMessage(slackId, text));
}

/** 실패 알림을 즉시 보내지 않고 지정한 시각(Unix epoch 초)에 도착하도록 예약한다(야간→아침 9시 등). */
export async function notifySalesSyncFailureAt(text: string, postAtEpochSeconds: number): Promise<void> {
  await notifyAlertTargets((slackId) => scheduleSlackDirectMessage(slackId, text, postAtEpochSeconds));
}
