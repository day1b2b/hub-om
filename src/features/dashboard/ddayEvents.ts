/** D-day 선정에 필요한 최소 모양. MyDashboard의 CalendarEvent가 이 모양을 만족한다. */
export interface DdayCandidate {
  start: Date;
  label: string;
  course: string;
  /** 운영 현황에서 온 일정인지, 담당 관리(업무요청)에서 온 일정인지. */
  source: "operation" | "request";
}

/**
 * 다음 과정 D-day에 쓸 일정을 고른다.
 *
 * **운영 현황에서 온 일정만** 본다. 담당 관리(업무요청)는 접수 단계라 아직 운영 현황에
 * 배정되지 않은 과정도 들어 있어서, 섞으면 "나한테 배정 안 된 과정"이 가장 임박한 일정으로
 * 떴다(실제 제보: 콜마그룹·CJONS 건이 D-day 상단을 차지). 캘린더(내 과정 일정)는 그대로
 * 둘 다 보여 준다 — 거기선 접수 건도 알고 있어야 한다.
 *
 * 오늘 시작하는 과정은 남긴다(D-DAY). 같은 날 여러 건이면 기업·과정명 순으로 세워
 * 순서가 흔들리지 않게 한다.
 */
export function selectDdayEvents<T extends DdayCandidate>(events: ReadonlyArray<T>, today: Date, limit: number): T[] {
  const todayTime = stripTime(today).getTime();

  return events
    .filter((event) => event.source === "operation" && event.start.getTime() >= todayTime)
    .sort((a, b) => {
      const diff = a.start.getTime() - b.start.getTime();
      if (diff !== 0) return diff;
      const byLabel = a.label.localeCompare(b.label, "ko");
      return byLabel !== 0 ? byLabel : a.course.localeCompare(b.course, "ko");
    })
    .slice(0, limit);
}

/** 시각을 떼고 날짜만 남긴다. 오늘 시작하는 과정이 "이미 지났다"로 걸러지지 않게. */
function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
