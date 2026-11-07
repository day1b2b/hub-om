import type { CoachLinkedSessionFacts } from "./coachTypes";
import { EDUCATION_FORMAT } from "./operationRowMapping";

/** 투입 화면에 필요한 회차 필드만. PG·Mongo 어댑터가 같은 모양으로 넘긴다. */
export interface CoachLinkedSessionRow {
  educationFormat: string;
  timeText?: string | null;
  deletedAt?: Date | null;
}

/** 지워진 회차는 연결 없음으로 본다(평가 저장소의 담당 OM 조회와 같은 기준). */
export function coachLinkedSession(row: CoachLinkedSessionRow | null | undefined): CoachLinkedSessionFacts | null {
  if (!row || row.deletedAt) return null;
  return {
    educationFormat: EDUCATION_FORMAT[row.educationFormat] ?? "검토필요",
    timeText: row.timeText?.trim() || null
  };
}
