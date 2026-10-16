// 업무 요청 수정에서 회차를 늘리거나 줄일 때의 계획을 세우는 순수 함수.
//
// 수정 화면은 저장할 회차 목록과 함께 sessionOrigins를 보낸다. sessionOrigins[i]는 저장할
// i번째 회차가 기존 몇 번째 회차(0부터)였는지, 새로 추가한 회차면 null이다. 화면에서 고른
// 회차만 지워야 하므로 서버는 회차 수만 보고 어느 회차를 지울지 추측하지 않는다.

export type SessionOrigin = number | null;

export type SessionCountPlan =
  | { ok: true; changed: boolean; removedIndexes: number[]; origins: SessionOrigin[] }
  | { ok: false; error: string };

export function planSessionCountChange(existingCount: number, nextCount: number, origins: unknown): SessionCountPlan {
  if (origins === undefined) {
    // 예전 화면처럼 출처 없이 보낸 저장은 회차 구성이 그대로일 때만 받는다.
    if (nextCount !== existingCount) return { ok: false, error: "회차 구성을 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 저장해 주세요." };
    return { ok: true, changed: false, removedIndexes: [], origins: Array.from({ length: existingCount }, (_, i) => i) };
  }
  if (!Array.isArray(origins) || origins.length !== nextCount) {
    return { ok: false, error: "회차 구성을 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 저장해 주세요." };
  }

  let previous = -1;
  const kept = new Set<number>();
  for (const origin of origins) {
    if (origin === null) continue;
    // 기존 회차는 원래 순서 그대로만 남길 수 있다. 순서 바꾸기는 운영현황에서 한다.
    if (!Number.isInteger(origin) || origin < 0 || origin >= existingCount || origin <= previous) {
      return { ok: false, error: "회차 구성을 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 저장해 주세요." };
    }
    previous = origin;
    kept.add(origin);
  }

  const removedIndexes = Array.from({ length: existingCount }, (_, i) => i).filter((i) => !kept.has(i));
  const changed = removedIndexes.length > 0 || origins.some((origin, i) => origin !== i);
  return { ok: true, changed, removedIndexes, origins: origins as SessionOrigin[] };
}

interface SessionSchedule { date: string; dateEnd?: string; timeStart: string; timeEnd: string; duration: string; location: string; educationDatesText?: string }

/** 운영현황 회차·캘린더에 들어가는 일정 값(교육일·시간·장소)이 바뀌었는지. */
export function sessionScheduleChanged(before: SessionSchedule, after: SessionSchedule): boolean {
  const key = (session: SessionSchedule) => [
    session.date ?? "", session.dateEnd || session.date || "", session.timeStart ?? "", session.timeEnd ?? "",
    session.duration ?? "", (session.location ?? "").trim(), (session.educationDatesText ?? "").trim()
  ].join("|");
  return key(before) !== key(after);
}
