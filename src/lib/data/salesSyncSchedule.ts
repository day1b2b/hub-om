/**
 * 야간 매출 동기화 실패 알림을 "새벽에 울리지 않고 오전 9시(KST)에" 보내기 위한 예약 시각 계산.
 * KST는 UTC+9 고정(서머타임 없음)이라 09:00 KST = 00:00 UTC다.
 * 따라서 지금 이후의 "다음 오전 9시 KST"는 "지금 이후의 다음 UTC 자정"과 같다.
 */

const DAY_SECONDS = 86_400;

/** nowMs(밀리초) 이후에 처음 오는 오전 9시 KST의 Unix epoch(초). Slack chat.scheduleMessage의 post_at용. */
export function nextKstNineAmEpochSeconds(nowMs: number): number {
  const nowSec = Math.floor(nowMs / 1000);
  // 00:00 UTC(=09:00 KST) 경계. 지금과 같거나 과거면 하루 더해 "엄격히 미래"로 만든다
  // (Slack post_at은 미래여야 하고, 4시 실행 기준이면 항상 같은 날 아침 9시가 나온다).
  let boundary = Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS;
  while (boundary <= nowSec) boundary += DAY_SECONDS;
  return boundary;
}
