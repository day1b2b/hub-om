// 알림 판정은 "한국 날짜" 기준이어야 한다. 컨테이너 TZ가 UTC여도 결과가 흔들리지 않게
// Asia/Seoul로 포맷한 YYYY-MM-DD 문자열만 쓰고, 날짜 계산은 UTC 자정 기준으로 한다.
export function kstDateString(now: Date = new Date()): string {
  // en-CA 로케일은 YYYY-MM-DD 형식을 준다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function shiftDateString(dateString: string, days: number): string {
  const base = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateString;

  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
