// 운영현황 1건(OperationSession = 회차)을 구글 캘린더 이벤트 본문으로 변환한다.
// 순수 함수만 두어 테스트에서 구글 호출 없이 검증할 수 있게 한다.

import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventBody } from "./calendarWriteClient";

const TIME_ZONE = "Asia/Seoul";

// "09:00 ~ 13:00", "09:00-18:00", "09:00~18:00" 등 구분자만 다른 표기를 모두 받는다.
const TIME_RANGE = /(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/;

export interface ParsedTimeRange {
  start: string;
  end: string;
}

/** timeText에서 시작·종료 시각을 뽑는다. 형식을 못 읽으면 null(=종일 일정). */
export function parseTimeRange(timeText: string | null | undefined): ParsedTimeRange | null {
  if (!timeText) return null;

  const matched = TIME_RANGE.exec(timeText);
  if (!matched) return null;

  const [, startHour, startMinute, endHour, endMinute] = matched;
  const start = `${startHour.padStart(2, "0")}:${startMinute}`;
  const end = `${endHour.padStart(2, "0")}:${endMinute}`;

  // 종료가 시작보다 이르면 표기 오류로 보고 종일 일정으로 떨어뜨린다.
  if (end <= start) return null;

  return { start, end };
}

/** YYYY-MM-DD에 하루를 더한다. 종일 일정의 end.date는 배타적이라 마지막 날 다음 날이어야 한다. */
export function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * 이벤트 제목. 노션 캘린더 기입 규칙과 같은 "[기업명] 과정명_N회차" 표기를 쓴다.
 * roundNo에 이미 "회차"/"차수"가 붙어 있으면 그대로 둔다.
 */
export function buildEventSummary(operation: Pick<OperationSession, "companyName" | "courseName" | "roundNo">): string {
  const base = `[${operation.companyName}] ${operation.courseName}`.trim();
  const round = operation.roundNo?.trim();
  if (!round) return base;

  const suffix = /회차|차수/.test(round) ? round : `${round}회차`;
  return `${base}_${suffix}`;
}

/** 운영 상세로 돌아올 수 있게 본문에 hub-om 링크를 남긴다. HUB_OM_BASE_URL 미설정이면 생략. */
function buildDescription(operation: OperationSession): string {
  const lines: string[] = ["hub-om 운영현황에서 자동 생성된 일정입니다. 수정은 hub-om에서 해주세요."];

  if (operation.om) lines.push(`담당 OM: ${operation.om}`);
  if (operation.onsiteOm) lines.push(`현장운영: ${operation.onsiteOm}`);
  if (operation.instructors) lines.push(`강사: ${operation.instructors}`);

  const baseUrl = process.env.HUB_OM_BASE_URL?.trim().replace(/\/$/, "");
  if (baseUrl) lines.push(`운영 상세: ${baseUrl}/operations/${operation.operationId}`);

  return lines.join("\n");
}

export function buildCalendarEventBody(operation: OperationSession, attendeeEmails: string[]): CalendarEventBody {
  const times = parseTimeRange(operation.timeText);

  // 시간 표기를 읽으면 시작일 시작시각 ~ 종료일 종료시각의 일정으로,
  // 못 읽으면 종일 일정으로 만든다. 종일 일정의 종료일은 배타적이다.
  const schedule = times
    ? {
        start: { dateTime: `${operation.startDate}T${times.start}:00`, timeZone: TIME_ZONE },
        end: { dateTime: `${operation.endDate}T${times.end}:00`, timeZone: TIME_ZONE }
      }
    : {
        start: { date: operation.startDate },
        end: { date: nextDay(operation.endDate) }
      };

  return {
    summary: buildEventSummary(operation),
    description: buildDescription(operation),
    // 참석자가 일정을 고치거나 다른 사람을 초대하지 못하게 막는다(스펙 D5: 반영 대상은 읽기 전용).
    // guestsCanModify는 기본값도 false지만, guestsCanInviteOthers는 기본이 true라
    // 명시하지 않으면 OM이 임의로 참석자를 늘릴 수 있다. 둘 다 못 박는다.
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    ...(operation.region ? { location: operation.region } : {}),
    ...schedule,
    ...(attendeeEmails.length > 0 ? { attendees: attendeeEmails.map((email) => ({ email })) } : {})
  };
}
