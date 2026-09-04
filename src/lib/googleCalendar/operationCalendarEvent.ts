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

/**
 * hub-om이 이벤트에 마지막으로 쓴 날짜·시간을 남기는 확장 속성 키.
 *
 * 역반영은 이벤트의 현재 날짜·시간을 이 표식과 비교해 "사람이 고쳤는지"를 가른다.
 * hub-om은 날짜·시간을 쓸 때마다 표식도 같은 patch로 갱신하므로, 둘이 다르면 그 뒤에
 * 사람이 고친 것이다 — 언제 고쳤는지(시각 차)에 기대지 않는다. 시각 차 규칙은 hub-om
 * 저장 직후 2분 안의 수정을 자기 잔향으로 오판해 조용히 되돌렸다(2026-09-04 실측).
 */
export const HUB_OM_SCHEDULE_PROPERTY = "hubOmSchedule";

type EventDateTime = { date?: string; dateTime?: string };

/** 종일/시간 지정 두 형태를 한 문자열로 만든다. 초·오프셋 표기 차이는 무시한다. 비교와 표식에 같은 값을 쓴다. */
export function scheduleKey(start: EventDateTime, end: EventDateTime): string {
  if (start.dateTime && end.dateTime) {
    return `time:${start.dateTime.slice(0, 16)}~${end.dateTime.slice(0, 16)}`;
  }

  return `allday:${start.date ?? ""}~${end.date ?? ""}`;
}

function withScheduleMarker<T extends { start: EventDateTime; end: EventDateTime }>(
  body: T
): T & { extendedProperties: { private: Record<string, string> } } {
  return {
    ...body,
    extendedProperties: { private: { [HUB_OM_SCHEDULE_PROPERTY]: scheduleKey(body.start, body.end) } }
  };
}

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

/**
 * 이벤트 설명 머리말. 매니저가 이 일정에서 할 수 있는 것과 없는 것을 그대로 적는다.
 * 동작이 바뀌면(주기·반영 필드·삭제 정책) 이 문구도 같이 바꾼다 — 안내와 실제가 어긋나면
 * "수정은 hub-om에서"라고 써 놓고 캘린더 수정이 반영되는 식으로 사람이 헷갈린다(2026-09-04).
 */
export const EVENT_DESCRIPTION_INTRO = [
  "hub-om 운영현황과 연동된 일정입니다.",
  "· 날짜·시간을 여기서 옮기면 5분 안에 hub-om에 반영됩니다.",
  "· 제목·장소는 hub-om 값으로 되돌아갑니다. 바꿀 일이 있으면 hub-om에서 고쳐주세요.",
  "· 이 일정을 삭제해도 hub-om에는 반영되지 않습니다. 회차 취소는 hub-om에서 해주세요."
];

/** 운영 상세로 돌아올 수 있게 본문에 hub-om 링크를 남긴다. HUB_OM_BASE_URL 미설정이면 생략. */
function buildDescription(operation: OperationSession): string {
  const lines: string[] = [...EVENT_DESCRIPTION_INTRO];

  if (operation.om) lines.push(`담당 OM: ${operation.om}`);
  if (operation.onsiteOm) lines.push(`현장운영: ${operation.onsiteOm}`);
  if (operation.instructors) lines.push(`강사: ${operation.instructors}`);

  // 이벤트 하나만 열어도 회차 전체 일정을 알 수 있게 교육일 목록을 남긴다.
  const educationDates = normalizeEducationDates(operation.educationDates);
  if (educationDates.length > 0) {
    lines.push(`교육일: ${formatEducationDatesCompact(educationDates)} (${educationDates.length}일)`);
  }

  // 구글 캘린더 설명은 <a> 같은 기본 HTML을 렌더링한다. 긴 주소 대신 "링크" 글자에 주소를 심는다
  // (2026-09-04 요청). 나머지 줄은 그대로 줄바꿈 텍스트다.
  const baseUrl = process.env.HUB_OM_BASE_URL?.trim().replace(/\/$/, "");
  if (baseUrl) lines.push(`운영 상세: <a href="${baseUrl}/operations/${operation.operationId}">링크</a>`);

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

  return withScheduleMarker({
    summary: buildEventSummary(operation, partKey),
    description: buildDescription(operation),
    // 초대받은 매니저가 자기 회차 이벤트의 날짜·시간을 개인 캘린더에서 고칠 수 있게 한다(스펙 D6).
    // 그 변경은 역반영(calendar-reverse-sync)이 운영현황으로 가져오고, 제목·장소 같은 나머지
    // 필드는 다음 실행에서 hub-om 값으로 원복된다(D7). 역반영 스케줄이 돌고 있을 때만 켜야 한다 —
    // 먼저 켜면 매니저의 수정이 운영현황으로 돌아오지 않아 두 쪽이 어긋난다.
    // guestsCanInviteOthers는 기본이 true라 명시하지 않으면 OM이 임의로 참석자를 늘릴 수 있다. 계속 막는다.
    guestsCanModify: true,
    guestsCanInviteOthers: false,
    ...(operation.region ? { location: operation.region } : {}),
    ...schedule,
    ...(attendeeEmails.length > 0 ? { attendees: attendeeEmails.map((email) => ({ email })) } : {})
  });
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
    // 구간마다 날짜가 다르므로 표식도 구간 값으로 다시 찍는다.
    body: withScheduleMarker({
      ...base,
      ...(times
        ? {
            start: { dateTime: `${start}T${times.start}:00`, timeZone: TIME_ZONE },
            end: { dateTime: `${end}T${times.end}:00`, timeZone: TIME_ZONE }
          }
        : { start: { date: start }, end: { date: nextDay(end) } })
    })
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
