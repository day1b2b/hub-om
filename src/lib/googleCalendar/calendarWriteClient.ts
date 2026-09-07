// 구글 캘린더 쓰기 클라이언트. refresh token으로 access token을 갱신하고
// events.insert / patch / delete만 호출한다. 읽기는 sourceReads 쪽 reader가 담당한다.

import { calendarLockSignal } from "./calendarOperationLock";
import { createHash } from "node:crypto";
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
    signal: requestSignal(),
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

/**
 * 캘린더와 같은 B2B 구글 계정(GOOGLE_CAL_OAUTH_*)의 access token.
 * 만족도 시트 읽기 등, 개별 사용자 권한 대신 공용 계정으로 구글 API를 호출할 때 재사용한다.
 * (이 토큰이 시트 스코프까지 가지려면 refresh token이 spreadsheets.readonly 동의를 포함해야 한다.)
 */
export async function getGoogleB2BAccessToken(): Promise<string> {
  return getAccessToken();
}

export interface CalendarEventAttendee {
  email: string;
}

export interface CalendarEventBody {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  attendees?: CalendarEventAttendee[];
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  /** hub-om 전용 표식. private는 이 앱(클라이언트)만 읽고 쓴다. */
  extendedProperties?: { private?: Record<string, string> };
}

function requestSignal(): AbortSignal {
  const lockSignal = calendarLockSignal();
  return lockSignal ? AbortSignal.any([lockSignal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
}

async function callCalendar(path: string, init: RequestInit): Promise<Response> {
  const accessToken = await getAccessToken();

  return fetch(`${CALENDAR_API}${path}`, {
    ...init,
    signal: requestSignal(),
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });
}

// 새 일정과 취소는 참석자가 반드시 알아야 하므로 메일을 보낸다(sendUpdates=all).
const SEND_UPDATES = "sendUpdates=all";

// 수정은 기본적으로 조용히 반영한다(sendUpdates=none).
// 교육일 구간마다 이벤트가 따로 있어서, 회차를 한 번 고치면 구간 수만큼 "일정이
// 변경되었습니다" 메일이 나간다. 장소 오타 하나에 두세 통이 가는 건 과하다.
// 캘린더 내용은 즉시 갱신되고 담당자는 자기 캘린더에서 최신 상태를 본다.
// 역반영이 제목·장소를 되돌릴 때도 이 경로라 조용히 처리된다.
//
// 예외는 참석자가 바뀐 수정이다. 이 서비스는 이벤트를 만들 때 담당 OM이 아직
// 배정되지 않은 경우가 많아(요청 접수 시 생성 → 나중에 배정), 초대 메일이 실제로
// 나가는 시점이 insert가 아니라 patch다. 참석자가 달라진 patch만 메일을 보낸다.
const SEND_UPDATES_SILENT = "sendUpdates=none";

/**
 * 새 이벤트를 만든다. 기본은 참석자에게 초대 메일을 보낸다(sendUpdates=all) — 정방향
 * 생성은 담당·현장 OM이 새 일정을 알아야 하기 때문이다(D11).
 *
 * notifyAttendees=false면 메일 없이 이벤트만 만든다(sendUpdates=none). 기능 도입 전
 * 등록된 과정을 일괄 소급 생성할 때, 수십~수백 통의 초대 메일이 한꺼번에 나가는 것을
 * 막기 위한 스위치다. Google 문서상 none은 외부 캘린더 동기화에 영향을 줄 수 있으므로
 * 참석자 캘린더 반영까지 보장하지 않는다. 소급 도구가 이 옵션을 쓴다.
 */
export async function insertEvent(
  calendarId: string,
  body: CalendarEventBody,
  options?: { notifyAttendees?: boolean }
): Promise<string> {
  const sendUpdates = options?.notifyAttendees === false ? SEND_UPDATES_SILENT : SEND_UPDATES;
  const response = await callCalendar(`/calendars/${encodeURIComponent(calendarId)}/events?${sendUpdates}`, {
    method: "POST",
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error(`events.insert 실패(${response.status}): ${await response.text()}`);

  const created = (await response.json()) as { id?: string };
  if (!created.id) throw new Error("events.insert 응답에 eventId가 없습니다.");

  return created.id;
}

/** 동일 생성 요청은 프로세스가 재시작되어도 같은 Google ID를 사용한다. */
export async function insertOperationEvent(
  calendarId: string,
  body: CalendarEventBody,
  identity: { operationId: string; eventDate: string; source: "forward" | "backfill"; previousEventId?: string; occupiedEventIds?: string[] },
  options?: { notifyAttendees?: boolean }
): Promise<string> {
  // source는 키에서 제외: 소급과 정방향이 동시에 실행되어도 같은 일정이다.
  const seed = JSON.stringify([
    "hub-om-calendar-v1", calendarId, identity.operationId, identity.eventDate, identity.previousEventId ?? ""
  ]);
  // 교육일을 제거했다가 다시 추가할 때 삭제된 ID는 재사용할 수 없다.
  // 무작위 ID로 우회하지 않고 같은 세대 순서를 탐색해 재시도도 같은 ID에 도달한다.
  for (let generation = 0; generation < 16; generation += 1) {
    const id = createHash("sha256").update(JSON.stringify([seed, generation])).digest("hex");
    if (identity.occupiedEventIds?.includes(id)) continue;
    const privateProperties = {
      ...body.extendedProperties?.private,
      hubOmCreationKey: id,
      hubOmCreationSource: identity.source
    };
    const sendUpdates = options?.notifyAttendees === false ? SEND_UPDATES_SILENT : SEND_UPDATES;
    const response = await callCalendar(`/calendars/${encodeURIComponent(calendarId)}/events?${sendUpdates}`, {
      method: "POST",
      body: JSON.stringify({ ...body, id, extendedProperties: { private: privateProperties } })
    });
    if (response.ok) {
      const created = await response.json() as { id?: string };
      if (created.id !== id) throw new Error("events.insert 응답의 생성 식별자가 일치하지 않습니다.");
      return id;
    }
    if (response.status !== 409) throw new Error(`events.insert 실패(${response.status})`);

    // 409만으로 성공으로 간주하지 않는다. 실제 이벤트와 우리 생성 표식을 확인한다.
    const existing = await callCalendar(`/calendars/${encodeURIComponent(calendarId)}/events/${id}`, { method: "GET" });
    if (!existing.ok) throw new Error(`기존 생성 이벤트 확인 실패(${existing.status}). 같은 요청으로 재시도하세요.`);
    const event = await existing.json() as { id?: string; status?: string; extendedProperties?: { private?: Record<string, string> } };
    if (event.id !== id) throw new Error("기존 생성 이벤트의 식별자가 다릅니다.");
    if (event.status === "cancelled") continue;
    if (event.extendedProperties?.private?.hubOmCreationKey !== id) {
      throw new Error("기존 이벤트의 생성 표식이 달라 자동 연결하지 않았습니다.");
    }
    return id;
  }
  throw new Error("삭제된 생성 식별자 탐색 상한에 도달했습니다. 관리자가 기존 연결을 확인해야 합니다.");
}

/**
 * 이 B2B 계정이 파트 캘린더에 대해 가진 접근 권한(accessRole)을 읽는다.
 * calendarList.get은 이 계정의 캘린더 목록에 등록된 캘린더의 권한을 돌려준다.
 *  - "owner"·"writer" = 이벤트를 만들 수 있음
 *  - "reader"·"freeBusyReader" = 읽기만 됨(insert는 403)
 *  - 계정 목록에 없으면 404 → null. 공유가 아예 안 됐거나 목록에 추가되지 않은 상태다.
 *
 * "2파트 캘린더에 일정이 하나도 없다" 같은 문제에서, 원인이 쓰기 권한(ACL) 미공유인지
 * 파트 매칭 실패인지 데이터로 가르기 위한 진단용이다. 쓰기는 하지 않는다.
 */
export async function readCalendarAccessRole(calendarId: string): Promise<string | null> {
  const response = await callCalendar(
    `/users/me/calendarList/${encodeURIComponent(calendarId)}?fields=accessRole`,
    { method: "GET" }
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`calendarList.get 실패(${response.status}): ${await response.text()}`);

  const payload = (await response.json()) as { accessRole?: string };
  return payload.accessRole ?? null;
}

/**
 * 부분 갱신을 허용한다. 역반영 원복은 제목·장소만 보내야 해서 전체 본문을 강제하지 않는다.
 * notifyAttendees=true일 때만 참석자에게 메일이 간다(기본은 조용히).
 *
 * 이벤트가 이미 없으면(404/410) 던지지 않고 "missing"으로 알린다. 사람이 캘린더에서
 * 지운 일정은 hub-om에 반영하지 않기로 했으므로(D8), 호출부가 그 상태를 오류가 아니라
 * 정상 분기로 다뤄야 한다.
 */
export async function patchEvent(
  calendarId: string,
  eventId: string,
  body: Partial<CalendarEventBody>,
  options?: { notifyAttendees?: boolean; expectedEtag?: string }
): Promise<"updated" | "missing"> {
  const response = await callCalendar(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${
      options?.notifyAttendees ? SEND_UPDATES : SEND_UPDATES_SILENT
    }`,
    { method: "PATCH", body: JSON.stringify(body), headers: options?.expectedEtag ? { "If-Match": options.expectedEtag } : {} }
  );

  if (response.status === 404 || response.status === 410) return "missing";
  if (!response.ok) throw new Error(`events.patch 실패(${response.status}): ${await response.text()}`);

  return "updated";
}

/**
 * 이벤트의 현재 참석자 이메일을 읽는다. patch가 초대 메일을 보내야 하는지
 * (참석자가 달라졌는지) 판단하는 데만 쓴다. 이벤트를 못 읽으면 null.
 */
export async function readEventAttendees(calendarId: string, eventId: string): Promise<null | string[]> {
  try {
    const response = await callCalendar(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?fields=attendees(email)`,
      { method: "GET" }
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as { attendees?: { email?: string }[] };

    return (payload.attendees ?? []).map((attendee) => attendee.email ?? "").filter(Boolean);
  } catch {
    // 읽기 실패로 반영 자체를 막지 않는다. 호출부는 "모른다"로 보고 조용히 갱신한다.
    return null;
  }
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

// ── 역반영용 읽기 ────────────────────────────────────────────────
// 같은 B2B 계정 토큰으로 events.list를 호출한다. 읽기 전용 서비스계정 reader는
// 이 캘린더에 접근 권한이 없고(소유자가 B2B 계정), 취소된 이벤트도 봐야 해서 여기 둔다.

export interface CalendarEventSnapshot {
  id: string;
  status: string;
  summary: string;
  location: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  updated: string;
  /** hub-om이 마지막으로 쓴 날짜·시간 키(extendedProperties.private.hubOmSchedule). 표식 없는 옛 이벤트는 null. */
  hubOmSchedule: null | string;
}

interface CalendarEventListResponse {
  items?: {
    id?: string;
    status?: string;
    summary?: string;
    location?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    updated?: string;
    extendedProperties?: { private?: Record<string, string> };
  }[];
  nextPageToken?: string;
}

const EVENT_FIELDS = "nextPageToken,items(id,status,summary,location,start,end,updated,extendedProperties)";
const EVENT_PAGE_SIZE = 250;
const MAX_PAGES = 10;

/**
 * updatedMin 이후에 바뀐 이벤트만 읽는다(취소된 것 포함).
 * syncToken 대신 시간 창을 쓰는 이유는 저장할 상태가 없어 마이그레이션이 필요 없고,
 * 실행이 한 번 빠져도 다음 실행의 창이 겹치면 자동으로 따라잡기 때문이다.
 */
export async function listUpdatedEvents(calendarId: string, updatedMinIso: string): Promise<CalendarEventSnapshot[]> {
  const events: CalendarEventSnapshot[] = [];
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      updatedMin: updatedMinIso,
      showDeleted: "true",
      singleEvents: "true",
      maxResults: String(EVENT_PAGE_SIZE),
      fields: EVENT_FIELDS
    });
    if (pageToken) query.set("pageToken", pageToken);

    const response = await callCalendar(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`, {
      method: "GET"
    });

    if (!response.ok) throw new Error(`events.list 실패(${response.status}): ${await response.text()}`);

    const payload = (await response.json()) as CalendarEventListResponse;

    for (const item of payload.items ?? []) {
      if (!item.id) continue;

      events.push({
        id: item.id,
        status: item.status ?? "confirmed",
        summary: item.summary ?? "",
        location: item.location ?? "",
        start: { date: item.start?.date, dateTime: item.start?.dateTime },
        end: { date: item.end?.date, dateTime: item.end?.dateTime },
        updated: item.updated ?? "",
        hubOmSchedule: item.extendedProperties?.private?.hubOmSchedule ?? null
      });
    }

    if (!payload.nextPageToken) return events;
    pageToken = payload.nextPageToken;
  }

  throw new Error(`events.list 페이지 상한(${MAX_PAGES})에 도달했습니다. 일부 결과를 전체 조회로 처리하지 않습니다.`);
}

export async function readCalendarEventVersion(calendarId: string, eventId: string): Promise<{ updated: string; etag: string; status: string }> {
  const response = await callCalendar(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?fields=updated,etag,status`, { method: "GET" });
  if (!response.ok) throw new Error(`이벤트 최신 상태 조회 실패(${response.status})`);
  const event = await response.json() as { updated?: string; etag?: string; status?: string };
  if (!event.updated || !event.etag || event.status === "cancelled") throw new Error("이벤트가 삭제되었거나 버전 정보를 확인할 수 없습니다.");
  return { updated: event.updated, etag: event.etag, status: event.status ?? "confirmed" };
}
