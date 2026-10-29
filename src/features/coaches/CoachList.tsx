"use client";

import { useMemo } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { PeopleDirectory, type PeopleFlag, type PeopleRow } from "@/features/people/PeopleDirectory";
import type { CoachActivity } from "@/lib/coaches/coachActivity";
import type { CoachStatusValue, CoachSummary } from "@/lib/data/coachTypes";
import { formatPeopleDate, type PeopleStatus } from "@/lib/people/peopleStatus";

/** 목록 한 줄. 활동·상태는 서버에서 오늘 기준으로 계산해 넘긴다. */
export type CoachListItem = Omit<CoachSummary, "engagementFacts"> & { activity: CoachActivity; peopleStatus: PeopleStatus };

// 코치 DB(노션) 상태. 활동중이 아니면 투입 이력과 별개로 섭외 전에 확인이 필요해 주의로 드러낸다.
const COACH_DB_FLAG: Partial<Record<CoachStatusValue, PeopleFlag>> = {
  pending: { label: "코치 DB 대기", tone: "warn" },
  inactive: { label: "코치 DB 비활동", tone: "warn" }
};

interface CoachListProps {
  coaches: CoachListItem[];
  loadFailed: boolean;
  /** 한국 기준 오늘(YYYY-MM-DD). 날짜 표기에 쓴다. */
  today: string;
}

export function CoachList({ coaches, loadFailed, today }: CoachListProps) {
  const rows = useMemo(() => coaches.map((coach) => toRow(coach, today)), [coaches, today]);
  const counts = useMemo(() => {
    const result: Record<PeopleStatus, number> = { booked: 0, active: 0, dormant: 0, never: 0 };
    for (const coach of coaches) result[coach.peopleStatus] += 1;
    return result;
  }, [coaches]);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coaches" teamScope="both" />

      <section className="content" id="coaches">
        <PeopleDirectory
          deployHeader="투입"
          emptyText="표시할 코치가 없습니다."
          extraHeader="근무일"
          lede={`진행·예정 ${counts.booked}명 · 활동 ${counts.active}명 · 휴면 ${counts.dormant}명 · 미투입 ${counts.never}명. 상태와 OM 평가는 투입 이력으로 계산합니다.`}
          loadFailed={loadFailed}
          loadFailedText="코치 데이터를 불러오지 못했습니다."
          ratingHeader="OM 평가"
          rows={rows}
          searchPlaceholder="이름 · 전문분야 · 근무유형 검색"
          secondaryLabel="근무유형"
          title="코치 위키"
        />
      </section>
    </main>
  );
}

function toRow(coach: CoachListItem, today: string): PeopleRow {
  const workTypes = splitWorkTypes(coach.workType);
  const flag = COACH_DB_FLAG[coach.status];
  const lastDeploy = coach.activity.lastDeployDate;
  const upcoming = coach.activity.upcomingCount > 0 ? `예정 ${coach.activity.upcomingCount}건` : "";

  return {
    id: coach.id,
    href: `/coaches/${coach.id}`,
    name: coach.name,
    status: coach.peopleStatus,
    fields: coach.fields,
    flags: flag ? [flag] : [],
    recent: lastDeploy ? [`최근 투입 ${formatPeopleDate(lastDeploy, today)}`, upcoming].filter(Boolean).join(" · ") : upcoming || null,
    subline: workTypes.length > 0 ? workTypes.join(" · ") : null,
    recentDate: lastDeploy,
    deployCount: coach.activity.deployCount,
    deployLabel: `${coach.activity.deployCount}회`,
    rating: coach.recentAvgRating,
    // 평균은 기준 건수를 채웠을 때만. 모자라면 건수만, 없으면 "-".
    ratingLabel:
      coach.recentAvgRating !== null
        ? `${coach.recentAvgRating.toFixed(1)} (${coach.recentRatingCount}건)`
        : coach.recentRatingCount > 0
          ? `평가 ${coach.recentRatingCount}건`
          : "-",
    extra: { label: "근무일", value: coach.workDayCount, text: `${coach.workDayCount}일` },
    secondary: workTypes,
    searchText: [coach.name, coach.workType ?? "", ...coach.fields].join(" ")
  };
}

function splitWorkTypes(value: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
