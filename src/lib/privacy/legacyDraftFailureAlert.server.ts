// 예전 초안 자동 정리가 실패하면 사용자 화면에는 띄우지 않고 관리자에게 Slack DM으로 알린다.
//
// 배경: 실패 원인(서버 격리 키 누락, 저장 공간, 구형 브라우저)은 사용자가 고칠 수 없다.
// 원문은 실패 시 지우지 않으므로 데이터 손실은 없고, 다음 방문에 자동 재시도한다.
// 서버 설정 문제는 모든 사용자에게 반복되므로 같은 사유는 1시간에 한 번만 보낸다.
//
// 수신자: SLACK_ADMIN_ALERT_EMAIL(서버 설정을 고칠 수 있는 기술 운영자, 팀 명단 이메일) → Slack DM.
// 고칠 수 없는 사람에게 보내지 않도록 다른 수신자로 대체하지 않는다. 미설정이면 조용히 넘어간다.
// 브라우저 저장소 오류(시크릿 모드 등)는 기술 운영자도 고칠 수 없어 보내지 않는다.

import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { sendSlackDirectMessage } from "@/lib/slack/notifySlack";

export const LEGACY_DRAFT_FAILURE_REASONS = {
  quarantine_failed: {
    title: "암호화 보관 또는 검증 실패",
    action: "Coolify에서 격리 키 환경변수(예전 초안 격리 키)와 서버 로그를 확인하고 재배포해주세요. 고치면 사용자 브라우저가 다음 접속 때 자동으로 다시 정리합니다.",
  },
  locks_unsupported: {
    title: "구형 브라우저라 자동 정리를 지원하지 않음",
    action: "아래 사용자에게 Chrome을 최신 버전으로 업데이트해달라고 알려주세요. 업데이트 후 접속하면 자동으로 정리됩니다.",
  },
} as const;
export type LegacyDraftFailureReason = keyof typeof LEGACY_DRAFT_FAILURE_REASONS;

const THROTTLE_MS = 60 * 60 * 1000;
const lastSent = new Map<string, number>();
const suppressed = new Map<string, number>();

export function buildLegacyDraftFailureMessage(reason: LegacyDraftFailureReason, reporter: string, skipped: number): string {
  return [
    "⚠️ 예전 초안 자동 정리 실패",
    `사유: ${LEGACY_DRAFT_FAILURE_REASONS[reason].title}`,
    `사용자: ${reporter}`,
    skipped ? `지난 알림 이후 같은 사유 ${skipped}건 더 발생` : "",
    `→ 할 일: ${LEGACY_DRAFT_FAILURE_REASONS[reason].action}`,
    "사용자 초안은 지워지지 않았고 사용자 화면에는 안내가 뜨지 않습니다."
  ].filter(Boolean).join("\n");
}

/** 절대 throw하지 않는다. now는 테스트용. */
export async function notifyLegacyDraftFailure(reason: LegacyDraftFailureReason, reporter: string, now = Date.now()): Promise<"sent" | "throttled" | "skipped"> {
  try {
    const last = lastSent.get(reason);
    if (last !== undefined && now - last < THROTTLE_MS) { suppressed.set(reason, (suppressed.get(reason) ?? 0) + 1); return "throttled"; }
    const email = process.env.SLACK_ADMIN_ALERT_EMAIL?.trim();
    if (!email) return "skipped";
    const target = (await listTeamUsers()).find(user => (user.email ?? "").trim().toLowerCase() === email.toLowerCase());
    if (!target?.slackId) { console.warn("[legacy-draft-alert] RECIPIENT_NOT_FOUND"); return "skipped"; }
    lastSent.set(reason, now);
    const skipped = suppressed.get(reason) ?? 0; suppressed.delete(reason);
    if (!await sendSlackDirectMessage(target.slackId, buildLegacyDraftFailureMessage(reason, reporter, skipped))) console.warn("[legacy-draft-alert] SEND_FAILED");
    return "sent";
  } catch {
    console.error("[legacy-draft-alert] FAILED");
    return "skipped";
  }
}
