// 운영현황 → 구글 캘린더 쓰기 설정.
//
// 읽기 전용 서비스계정(src/lib/sourceReads/googleCalendarSourceReader.ts)과는 별개 경로다.
// 서비스계정은 도메인 전체 위임 없이는 참석자를 초대할 수 없어서, 담당 OM·현장운영 OM을
// 초대해야 하는 이 기능은 B2B 전용 계정 OAuth(refresh token)를 쓴다.
// 배경과 결정은 docs/plans/2026-08-19-operations-calendar-reflect.md (D3·D5) 참고.

const PART_KEYS = ["1파트", "2파트", "3파트"] as const;

export interface CalendarWriteCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** 세 값이 모두 있을 때만 자격증명으로 인정한다. 하나라도 비면 연동을 끈다. */
export function readCalendarWriteCredentials(): CalendarWriteCredentials | null {
  const clientId = process.env.GOOGLE_CAL_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CAL_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = process.env.GOOGLE_CAL_OAUTH_REFRESH_TOKEN?.trim() ?? "";

  if (!clientId || !clientSecret || !refreshToken) return null;

  return { clientId, clientSecret, refreshToken };
}

/**
 * 멤버 관리(TeamUser.team)는 "AX 1파트", OM 요청(request.team)은 "1파트"로 저장된다.
 * 두 표기가 공유하는 "N파트"만 뽑아 매칭 키로 쓴다.
 * omAvailabilityLocalRepository의 같은 이름 함수와 동일한 규칙이다.
 */
export function extractPartKey(value: string | null | undefined): string | null {
  if (!value) return null;
  return PART_KEYS.find((key) => value.includes(key)) ?? null;
}

/**
 * GOOGLE_CAL_PART_CALENDARS="1파트:calId,2파트:calId,3파트:calId"
 * SLACK_OM_REQUEST_CHANNELS와 같은 형식이라 운영자가 익숙한 문법을 그대로 쓴다.
 * 캘린더 ID에는 콤마가 없고 첫 콜론까지가 파트 키이므로 indexOf로 자른다.
 */
export function resolvePartCalendarId(part: string | null | undefined): string {
  const partKey = extractPartKey(part);
  if (!partKey) return "";

  const raw = process.env.GOOGLE_CAL_PART_CALENDARS?.trim();
  if (!raw) return "";

  for (const entry of raw.split(",")) {
    const sep = entry.indexOf(":");
    if (sep === -1) continue;

    const key = entry.slice(0, sep).trim();
    const calendarId = entry.slice(sep + 1).trim();
    if (key && calendarId && key === partKey) return calendarId;
  }

  return "";
}

/** 자격증명과 파트 캘린더 매핑이 모두 있어야 반영을 시도한다. */
export function isCalendarWriteEnabled(): boolean {
  return Boolean(readCalendarWriteCredentials()) && Boolean(process.env.GOOGLE_CAL_PART_CALENDARS?.trim());
}

/**
 * GOOGLE_CAL_PART_CALENDARS에 등록된 모든 파트 캘린더를 돌려준다.
 * 역반영은 특정 파트가 아니라 세 캘린더 전체의 변경을 훑어야 하므로 목록이 필요하다.
 * 같은 캘린더 ID가 두 파트에 걸려 있으면 한 번만 훑도록 중복을 제거한다.
 */
export function listPartCalendars(): { partKey: string; calendarId: string }[] {
  const raw = process.env.GOOGLE_CAL_PART_CALENDARS?.trim();
  if (!raw) return [];

  const seen = new Set<string>();
  const calendars: { partKey: string; calendarId: string }[] = [];

  for (const entry of raw.split(",")) {
    const sep = entry.indexOf(":");
    if (sep === -1) continue;

    const partKey = entry.slice(0, sep).trim();
    const calendarId = entry.slice(sep + 1).trim();
    if (!partKey || !calendarId || seen.has(calendarId)) continue;

    seen.add(calendarId);
    calendars.push({ partKey, calendarId });
  }

  return calendars;
}
