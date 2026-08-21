// 구글 캘린더 쓰기 클라이언트. refresh token으로 access token을 갱신하고
// events.insert / patch / delete만 호출한다. 읽기는 sourceReads 쪽 reader가 담당한다.

import { readCalendarWriteCredentials } from "./calendarWriteConfig";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// access token은 1시간짜리다. 만료 60초 전에 갱신해 경계에서 401이 나지 않게 한다.
const EXPIRY_MARGIN_MS = 60_000;

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
    return cachedToken.value;
  }

  const credentials = readCalendarWriteCredentials();
  if (!credentials) throw new Error("구글 캘린더 쓰기 자격증명(GOOGLE_CAL_OAUTH_*)이 없습니다.");

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token"
    })
  });

  const payload = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!payload.access_token) {
    // 토큰 값 자체는 로그에 남기지 않는다.
    throw new Error(`access token 갱신 실패: ${payload.error ?? response.status}`);
  }

  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000
  };

  return cachedToken.value;
}

/** 테스트와 자격증명 교체 상황을 위해 캐시를 비운다. */
export function resetAccessTokenCache(): void {
  cachedToken = null;
}

export interface CalendarEventAttendee {
  email: string;
}

export interface CalendarEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  attendees?: CalendarEventAttendee[];
}

async function callCalendar(path: string, init: RequestInit): Promise<Response> {
  const accessToken = await getAccessToken();

  return fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });
}

// 참석자에게 초대 메일이 가도록 sendUpdates=all을 항상 붙인다.
const SEND_UPDATES = "sendUpdates=all";

export async function insertEvent(calendarId: string, body: CalendarEventBody): Promise<string> {
  const response = await callCalendar(`/calendars/${encodeURIComponent(calendarId)}/events?${SEND_UPDATES}`, {
    method: "POST",
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error(`events.insert 실패(${response.status}): ${await response.text()}`);

  const created = (await response.json()) as { id?: string };
  if (!created.id) throw new Error("events.insert 응답에 eventId가 없습니다.");

  return created.id;
}

export async function patchEvent(calendarId: string, eventId: string, body: CalendarEventBody): Promise<void> {
  const response = await callCalendar(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${SEND_UPDATES}`,
    { method: "PATCH", body: JSON.stringify(body) }
  );

  if (!response.ok) throw new Error(`events.patch 실패(${response.status}): ${await response.text()}`);
}

/**
 * 이미 지워진 이벤트(404/410)는 목표 상태(없음)와 같으므로 성공으로 본다.
 * 매핑만 남고 이벤트가 사라진 경우에 정리를 막지 않기 위해서다.
 */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  const response = await callCalendar(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${SEND_UPDATES}`,
    { method: "DELETE" }
  );

  if (response.ok || response.status === 404 || response.status === 410) return;

  throw new Error(`events.delete 실패(${response.status}): ${await response.text()}`);
}
