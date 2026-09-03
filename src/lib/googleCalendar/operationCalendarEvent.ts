// 운영현황 1건(OperationSession = 회차)을 구글 캘린더 이벤트 본문으로 변환한다.
// 순수 함수만 두어 테스트에서 구글 호출 없이 검증할 수 있게 한다.
//
// 실제 교육일(educationDates)이 있으면 **연속 구간마다 이벤트를 하나씩** 만든다.
// 9/7·9/8·9/9·9/11이면 [9/7~9/9] 1건 + [9/11] 1건 = 2건이다.
// 기간 이벤트 하나로 묶으면 쉬는 날까지 일정이 잡히고(9/04~9/08 중 9/05·9/06 휴무),
// 하루씩 쪼개면 초대·변경 메일이 날짜 수만큼 나간다. 연속 구간이 그 사이의 답이다.
// 알림 표기(formatEducationDatesCompact)와 같은 단위라 두 곳이 다르게 읽히지 않는다.
// 교육일이 없는 회차는 기존처럼 기간 이벤트 1건으로 둔다.

import { formatEducationDatesCompact, groupConsecutiveDateRuns } from "@/lib/data/operationCalculations";
import type { OperationSession } from "@/lib/data/operationTypes";
import type { CalendarEventBody } from "./calendarWriteClient";
import { extractPartKey } from "./calendarWriteConfig";

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
 * 1파트만 "[강의관리] 기업명_과정명_N회차" 표기를 쓴다(2026-09-02 1파트 요청).
 * 파트 판별은 캘린더를 고를 때 쓰는 partKey와 같은 값이라, 일정이 올라간 캘린더와
 * 제목 규칙이 어긋날 수 없다. 다른 파트를 추가하려면 이 목록에만 넣으면 된다.
 */
const LECTURE_TITLE_PARTS = ["1파트"];

/**
 * 이벤트 제목. 기본은 노션 캘린더 기입 규칙과 같은 "[기업명] 과정명_N회차" 표기다.
 * roundNo에 이미 "회차"/"차수"가 붙어 있으면 그대로 둔다.
 * partKey는 resolveCalendarTargets가 담당 OM의 소속 팀에서 뽑은 "N파트"다.
 */
export function buildEventSummary(
  operation: Pick<OperationSession, "companyName" | "courseName" | "roundNo">,
  partKey?: string | null
): string {
  const round = operation.roundNo?.trim();
  const suffix = round ? (/회차|차수/.test(round) ? round : `${round}회차`) : "";

  const part = extractPartKey(partKey);
  if (part && LECTURE_TITLE_PARTS.includes(part)) {
    // 기업명이 비어 있어도 "_"로 시작하지 않도록 빈 조각은 빼고 잇는다.
    const segments = [operation.companyName.trim(), operation.courseName.trim(), suffix].filter(Boolean);
    return `[강의관리] ${segments.join("_")}`;
  }

  const base = `[${operation.companyName}] ${operation.courseName}`.trim();
  return suffix ? `${base}_${suffix}` : base;
}

/** 운영 상세로 돌아올 수 있게 본문에 hub-om 링크를 남긴다. HUB_OM_BASE_URL 미설정이면 생략. */
function buildDescription(operation: OperationSession): string {
  const lines: string[] = ["hub-om 운영현황에서 자동 생성된 일정입니다. 수정은 hub-om에서 해주세요."];

  if (operation.om) lines.push(`담당 OM: ${operation.om}`);
  if (operation.onsiteOm) lines.push(`현장운영: ${operation.onsiteOm}`);
  if (operation.instructors) lines.push(`강사: ${operation.instructors}`);

  // 이벤트 하나만 열어도 회차 전체 일정을 알 수 있게 교육일 목록을 남긴다.
  const educationDates = normalizeEducationDates(operation.educationDates);
  if (educationDates.length > 0) {
    lines.push(`교육일: ${formatEducationDatesCompact(educationDates)} (${educationDates.length}일)`);
  }

  const baseUrl = process.env.HUB_OM_BASE_URL?.trim().replace(/\/$/, "");
  if (baseUrl) lines.push(`운영 상세: ${baseUrl}/operations/${operation.operationId}`);

  return lines.join("\n");
}

export function buildCalendarEventBody(
  operation: OperationSession,
  attendeeEmails: string[],
  partKey?: string | null
): CalendarEventBody {
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
    summary: buildEventSummary(operation, partKey),
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

export interface CalendarEventPlan {
  /** 이 이벤트가 담당하는 연속 구간의 시작 교육일(YYYY-MM-DD). 매핑 키로 쓴다. */
  eventDate: string;
  /** 구간의 마지막 교육일. 하루짜리면 eventDate와 같다. */
  eventEndDate: string;
  body: CalendarEventBody;
}

/**
 * 회차를 이벤트 계획 목록으로 바꾼다.
 * 실제 교육일이 있으면 **연속 구간마다 1건**, 없으면 기간 이벤트 1건(키=시작일)이다.
 */
export function buildCalendarEventBodies(
  operation: OperationSession,
  attendeeEmails: string[],
  partKey?: string | null
): CalendarEventPlan[] {
  const base = buildCalendarEventBody(operation, attendeeEmails, partKey);
  const runs = groupConsecutiveDateRuns(normalizeEducationDates(operation.educationDates));

  if (runs.length === 0) {
    return [{ eventDate: operation.startDate, eventEndDate: operation.endDate, body: base }];
  }

  const times = parseTimeRange(operation.timeText);

  return runs.map(({ start, end }) => ({
    eventDate: start,
    eventEndDate: end,
    body: {
      ...base,
      ...(times
        ? {
            start: { dateTime: `${start}T${times.start}:00`, timeZone: TIME_ZONE },
            end: { dateTime: `${end}T${times.end}:00`, timeZone: TIME_ZONE }
          }
        : { start: { date: start }, end: { date: nextDay(end) } })
    }
  }));
}

/** 형식이 맞는 날짜만 남기고 중복을 제거해 날짜순으로 정렬한다. */
export function normalizeEducationDates(dates: string[] | null | undefined): string[] {
  const valid = (dates ?? [])
    .map((date) => date?.trim() ?? "")
    .filter((date) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date));

  return [...new Set(valid)].sort();
}

/**
 * 참석자 목록이 실제로 달라졌는지. 순서·대소문자·중복은 차이로 보지 않는다.
 * 이벤트를 못 읽어 before가 null이면 "모른다"이므로 달라지지 않은 것으로 본다
 * (판단 근거 없이 초대 메일을 다시 보내지 않는 쪽이 안전하다).
 */
export function attendeesChanged(before: null | string[], after: string[]): boolean {
  if (before === null) return false;

  const normalize = (emails: string[]) =>
    [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))].sort();

  const a = normalize(before);
  const b = normalize(after);

  return a.length !== b.length || a.some((email, index) => email !== b[index]);
}
