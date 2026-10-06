import { toDateKey } from "@/lib/coaches/dateParse";
import type { MyActiveReservation, MyConfirmedCourse, MyConfirmedCourseRound } from "./coachManagerMyPageRepository";

export type MyPageEngagementStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

const STATUS_LABEL: Record<MyPageEngagementStatus, string> = {
  SCHEDULED: "예정",
  IN_PROGRESS: "진행",
  COMPLETED: "완료",
  CANCELLED: "취소"
};

export interface EngagementWithCoach {
  coach: { id: string; name: string };
  engagement: {
    id: string;
    courseName: string;
    startDate: Date;
    endDate: Date;
    status: MyPageEngagementStatus;
    rating: number | null;
    feedback: string | null;
    rehire: boolean | null;
  };
}

export interface MyConfirmedCourseScheduleRow {
  engagementId: string;
  date: Date;
  startTime: string;
  endTime: string;
}
export interface MyActiveReservationRow {
  date: Date;
  coach: { id: string; name: string };
}

export function toMyActiveReservations(rows: readonly MyActiveReservationRow[]): MyActiveReservation[] {
  return rows.map((row) => ({ coachId: row.coach.id, coachName: row.coach.name, date: toDateKey(row.date) }));
}

/** Preserves encounter order for coaches and slots, groups exact course names,
 * unions coach date ranges and sorts courses by descending end date.
 * Adapters supply their legacy deduplicated engagement map and date-ordered live slots.
 */
export function groupConfirmedCourses(engagements: Iterable<EngagementWithCoach>, scheduleRows: readonly MyConfirmedCourseScheduleRow[]): MyConfirmedCourse[] {
  const roundsByEngagement = new Map<string, MyConfirmedCourseRound[]>();
  for (const schedule of scheduleRows) {
    const list = roundsByEngagement.get(schedule.engagementId) ?? [];
    list.push({ date: toDateKey(schedule.date), startTime: schedule.startTime, endTime: schedule.endTime });
    roundsByEngagement.set(schedule.engagementId, list);
  }

  const groups = new Map<string, MyConfirmedCourse>();
  for (const { coach, engagement } of engagements) {
    const engagementStartDate = toDateKey(engagement.startDate);
    const engagementEndDate = toDateKey(engagement.endDate);

    let group = groups.get(engagement.courseName);
    if (!group) {
      group = { courseName: engagement.courseName, startDate: engagementStartDate, endDate: engagementEndDate, coaches: [] };
      groups.set(engagement.courseName, group);
    } else {
      if (engagementStartDate < group.startDate) group.startDate = engagementStartDate;
      if (engagementEndDate > group.endDate) group.endDate = engagementEndDate;
    }

    if (!group.coaches.some((c) => c.engagementId === engagement.id)) {
      group.coaches.push({
        coachId: coach.id,
        coachName: coach.name,
        engagementId: engagement.id,
        startDate: engagementStartDate,
        endDate: engagementEndDate,
        statusLabel: STATUS_LABEL[engagement.status],
        rating: engagement.rating,
        feedback: engagement.feedback,
        rehire: engagement.rehire,
        rounds: roundsByEngagement.get(engagement.id) ?? []
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.endDate.localeCompare(a.endDate));
}

export interface PartitionedConfirmedCourses {
  inProgress: MyConfirmedCourse[];
  past: MyConfirmedCourse[];
}

// 과정 전체 기간(코치들 중 가장 늦은 종료일)이 오늘보다 이전이면 지난 과정으로,
// 그 외(오늘 포함 진행 중이거나 아직 시작 전)에는 진행중 과정으로 분류한다.
export function partitionConfirmedCourses(courses: MyConfirmedCourse[], todayIso: string): PartitionedConfirmedCourses {
  const inProgress: MyConfirmedCourse[] = [];
  const past: MyConfirmedCourse[] = [];

  for (const course of courses) {
    if (course.endDate < todayIso) past.push(course);
    else inProgress.push(course);
  }

  return {
    inProgress: inProgress.sort((a, b) => a.startDate.localeCompare(b.startDate)),
    past
  };
}
