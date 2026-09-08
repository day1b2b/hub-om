// 캘린더 정방향 반영이 "조용히" 건너뛰어질 때 담당자에게 Slack DM으로 알린다.
//
// 배경: reflectOperation은 파트를 못 정하면(담당 OM 미배정 + 요청 LD 소속이 파트 아님)
// 이벤트를 만들지 못하고 로그만 남긴 채 넘어간다. 이게 무음이라 누락이 조용히 쌓였다
// (2026-09-08까지 실제로 그랬다). 매번 손으로 찾아 고치던 사람에게 그 순간 알려,
// 담당/파트를 지정하면 다음 저장에서 반영되게 한다.
//
// 수신자는 env로 정한다: SLACK_CALENDAR_ALERT_EMAIL(팀 명단의 이메일) → 그 사람 Slack ID로 DM.
// 미설정이면 조용히 넘어간다 — 알림 경로 문제로 반영·저장이 막히면 안 되기 때문이다(스펙 §6).

import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import type { OperationSession } from "@/lib/data/operationTypes";
import { sendSlackDirectMessage } from "@/lib/slack/notifySlack";

/** 알림 문구. 담당자가 무엇을·어디서 고칠지 바로 알 수 있게 적는다. 순수 함수(테스트용). */
export function buildCalendarReflectSkipMessage(operation: OperationSession, reason: string): string {
  const round = operation.roundNo?.trim();
  const suffix = round ? (/회차|차수/.test(round) ? round : `${round}회차`) : "";
  const title = [`[${operation.companyName}] ${operation.courseName}`.trim(), suffix].filter(Boolean).join("_");

  const baseUrl = process.env.HUB_OM_BASE_URL?.trim().replace(/\/$/, "");
  const detail = baseUrl ? `${baseUrl}/operations/${operation.operationId}` : `운영ID ${operation.operationId}`;

  return [
    "⚠️ 캘린더 자동 반영 안 됨",
    title,
    `사유: ${reason}`,
    `담당 OM: ${operation.om?.trim() || "미배정"} · 담당 LD: ${operation.ld?.trim() || "미상"}`,
    `운영 상세: ${detail}`,
    "→ 담당/파트를 확인해 hub-om에서 다시 저장하면 반영됩니다."
  ].join("\n");
}

/**
 * 반영 건너뜀을 수신자(SLACK_CALENDAR_ALERT_EMAIL)에게 DM으로 알린다.
 * 절대 throw하지 않는다 — 호출부(reflectOperation)의 "저장을 되돌리지 않는다" 원칙을 지킨다.
 */
export async function notifyCalendarReflectSkip(operation: OperationSession, reason: string): Promise<void> {
  try {
    const email = process.env.SLACK_CALENDAR_ALERT_EMAIL?.trim();
    if (!email) return; // 수신자 미설정 = 알림 끔.

    const target = (await listTeamUsers()).find(
      (user) => (user.email ?? "").trim().toLowerCase() === email.toLowerCase()
    );
    if (!target?.slackId) {
      console.warn(`[gcal-alert] 수신자(${email})의 Slack ID를 명단에서 찾지 못해 알림을 건너뜀`);
      return;
    }

    const sent = await sendSlackDirectMessage(target.slackId, buildCalendarReflectSkipMessage(operation, reason));
    if (!sent) console.warn(`[gcal-alert] ${operation.operationId} 반영 건너뜀 DM 발송 실패`);
  } catch (error) {
    console.error("[gcal-alert] 반영 건너뜀 알림 전송 오류:", error);
  }
}
