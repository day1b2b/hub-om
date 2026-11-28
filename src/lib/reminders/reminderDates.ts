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

/**
 * dateString에서 영업일 count일 뒤 날짜(YYYY-MM-DD). 토·일과 isHoliday가 true인 날은 건너뛴다.
 * 공휴일 판정은 주입한다(이 모듈은 순수 유지). count<=0이면 그대로 돌려준다.
 */
export function addBusinessDays(dateString: string, count: number, isHoliday: (dateString: string) => boolean = () => false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || count <= 0) return dateString;
  let current = dateString;
  let added = 0;
  let guard = 0;
  while (added < count && guard < 400) {
    current = shiftDateString(current, 1);
    guard += 1;
    const dayOfWeek = new Date(`${current}T00:00:00Z`).getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // 일(0)·토(6)
    if (isHoliday(current)) continue;
    added += 1;
  }
  return current;
}
