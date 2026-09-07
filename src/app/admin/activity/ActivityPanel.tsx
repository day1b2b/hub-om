"use client";

import { useEffect, useState } from "react";
import fieldPolicy from "@/lib/activity/field-policy.json";
import styles from "./activity.module.css";

type Entry = {
  id: string; occurredAt: string; actorEmail: string | null; actorName: string | null;
  actorType: string; route: string; method: string; requestId?: string; targetType?: string;
  targetId?: string; action?: string; status?: number; durationMs?: number;
  changes?: Record<string, { before?: unknown; after?: unknown; redacted?: boolean }>;
};
const actions: Record<string, string> = { create: "생성", update: "수정", delete: "삭제", restore: "복구" };
const actors: Record<string, string> = { user: "사용자", token_request: "토큰 요청", anonymous: "미확인", development: "개발" };
const targets: Record<string, string> = {
  operation_sessions: "운영 회차", courses: "과정", companies: "기업", course_id_labels: "코스ID명",
  coaches: "코치", coach_private_profiles: "코치 개인정보", coach_content_entries: "코치 메모",
  coach_engagements: "코치 투입", coach_engagement_schedules: "코치 투입 일정", coach_schedules: "코치 일정",
  coach_day_reservations: "코치 예약", team_users: "팀 사용자", members: "멤버", om_requests: "업무 요청",
  announcements: "공지", announcement_attachments: "공지 첨부", instructor_notes: "강사 위키",
  calendar_event_links: "캘린더 연결", coach_fields: "코치 분야 연결", coach_curriculums: "코치 과정 연결",
  coach_field_masters: "분야", coach_curriculum_masters: "교육 과정"
};
const fields: Record<string, string> = { operation_status: "운영 상태", archive_status: "아카이브 상태", start_date: "시작일", end_date: "종료일", round_no: "회차", course_name: "과정명", name: "이름", content: "본문", phone: "연락처", email: "이메일", manager_note: "관리 메모", status: "상태", om_name: "담당 OM", ld_name: "담당 LD", deleted_at: "삭제 시각", access_token: "접근 토큰", revenue: "매출", total_cost: "총비용" };
function valueText(value: unknown): string {
  if (value === null || value === undefined) return "없음";
  if (typeof value === "object" && "truncated" in value && value.truncated) return `${"preview" in value ? String(value.preview) : ""}… (일부만 보관)`;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function ActivityPanel() {
  const [tab, setTab] = useState("changes");
  const [filters, setFilters] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ entries: Entry[]; nextCursor: string | null } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const cursor = cursors[page] ?? "";
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(filters);
    query.set("tab", tab);
    if (cursor) query.set("cursor", cursor);
    fetch(`/api/admin/activity?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? "활동 기록을 불러오지 못했습니다.");
        }
        return response.json();
      })
      .then((data) => { setResult(data); setError(""); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, tab, cursor, refresh]);
  function reset() { setPage(0); setCursors([""]); setLoading(true); setError(""); }
  return <div className={styles.panel}>
    <nav className={styles.tabs} aria-label="활동 기록 종류">
      <button aria-pressed={tab === "changes"} onClick={() => { setTab("changes"); setFilters(""); reset(); setRefresh((value) => value + 1); }}>변경 이력</button>
      <button aria-pressed={tab === "requests"} onClick={() => { setTab("requests"); setFilters(""); reset(); setRefresh((value) => value + 1); }}>API 요청</button>
    </nav>
    <p className={styles.note}>{tab === "changes" ? "실제 저장된 변경만 표시합니다. 민감정보와 자유 입력 본문은 변경 여부만 남기며, 같은 요청 ID의 변경은 하나의 API 작업에서 발생했습니다. 보관 기준은 365일입니다." : "요청 횟수는 클릭 수와 다릅니다. 자동 조회와 실패한 요청도 포함하며, 인증 단계에서 차단되어 API에 도달하지 않은 요청은 포함하지 않습니다. 보관 기준은 30일입니다."}</p>
    <form key={tab} className={styles.filters} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const query = new URLSearchParams();
      for (const [key, value] of data) if (String(value)) query.set(key, String(value));
      setFilters(query.toString()); reset(); setRefresh((value) => value + 1);
    }}>
      <label>사용자 이메일<input name="email" type="search" placeholder="이메일 검색" /></label>
      <label>시작일<input name="from" type="date" /></label>
      <label>종료일<input name="until" type="date" /></label>
      <label>실행 주체<select name="actorType"><option value="">전체</option>{Object.entries(actors).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      {tab === "changes" ? <>
        <label>작업<select name="action"><option value="">전체</option>{Object.entries(actions).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>대상<select name="targetType"><option value="">전체</option>{Object.keys(fieldPolicy).map((key) => <option key={key} value={key}>{targets[key] ?? key}</option>)}</select></label>
        <label>대상 ID<input name="targetId" placeholder="정확한 대상 ID" /></label>
      </> : <>
        <label>API 경로<input name="route" placeholder="/api/operations" /></label>
        <label>결과<select name="errors"><option value="">전체</option><option value="true">실패만 (400 이상)</option></select></label>
      </>}
      <label>요청 ID<input name="requestId" placeholder="연결된 요청 찾기" /></label>
      <button type="submit">조회</button>
      <button type="button" onClick={() => { reset(); setRefresh((value) => value + 1); }}>새로고침</button>
    </form>
    <div aria-live="polite">
      {loading ? <p role="status">활동 기록을 불러오는 중입니다…</p> : error ? <p role="alert" className={styles.error}>{error}</p> : !result?.entries.length ? <p className={styles.empty}>조건에 맞는 활동 기록이 없습니다.</p> : <>
        <div className={styles.tableWrap}><table><thead><tr><th>시각 (한국)</th><th>사용자</th><th>{tab === "changes" ? "변경 내용" : "API 요청"}</th><th>{tab === "changes" ? "상세" : "결과"}</th></tr></thead>
          <tbody>{result.entries.map((entry) => <tr key={entry.id}>
            <td>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(entry.occurredAt))}</td>
            <td>{entry.actorName || entry.actorEmail || actors[entry.actorType]}<small>{entry.actorEmail}</small><small>{actors[entry.actorType]}</small></td>
            <td>{tab === "changes" ? <>{targets[entry.targetType!] ?? entry.targetType} · {actions[entry.action!] ?? entry.action}<small>{entry.targetId}</small></> : <>{entry.method} {entry.route}<small>요청 ID: {entry.id}</small></>}</td>
            <td>{tab === "changes" ? <details><summary>{Object.keys(entry.changes ?? {}).length}개 필드</summary>
              <p className={styles.metadata}>요청 ID: {entry.requestId}<br />{entry.method} {entry.route}</p>
              <dl>{Object.entries(entry.changes ?? {}).map(([key, change]) => <div key={key}><dt>{fields[key] ?? key}</dt><dd>{change.redacted ? "변경됨 (값 미보관)" : <>{valueText(change.before)} → {valueText(change.after)}</>}</dd></div>)}</dl>
            </details> : <><strong className={(entry.status ?? 0) >= 400 ? styles.error : ""}>{entry.status}</strong><small>{entry.durationMs} ms</small></>}</td>
          </tr>)}</tbody></table></div>
      </>}
    </div>
    <div className={styles.pagination}>
      <button disabled={loading || page === 0} onClick={() => { setPage(page - 1); setLoading(true); }}>이전</button>
      <span>{page + 1}페이지 · 최대 50건</span>
      <button disabled={loading || !!error || !result?.nextCursor} onClick={() => {
        if (!result?.nextCursor) return;
        setCursors([...cursors.slice(0, page + 1), result.nextCursor]); setPage(page + 1); setLoading(true);
      }}>다음</button>
    </div>
  </div>;
}
