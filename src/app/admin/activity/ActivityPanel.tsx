"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import fieldPolicy from "@/lib/activity/field-policy.json";
import styles from "./activity.module.css";

type Entry = {
  id: string; occurredAt: string; actorEmail: string | null; actorName: string | null;
  actorType: string; route: string; method: string; requestId?: string; targetType?: string;
  targetId?: string; action?: string; status?: number; durationMs?: number;
  targetLabel?: string; targetHref?: string | null; labelSource?: string; description?: string; legacy?: boolean;
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
const fields: Record<string, string> = { event_date: "교육일", operation_id: "운영 건 ID", event_id: "캘린더 일정 ID", calendar_id: "캘린더 ID", operation_status: "운영 상태", archive_status: "아카이브 상태", start_date: "시작일", end_date: "종료일", round_no: "회차", course_name: "과정명", name: "이름", content: "본문", phone: "연락처", email: "이메일", manager_note: "관리 메모", status: "상태", om_name: "담당 OM", ld_name: "담당 LD", deleted_at: "삭제 시각", access_token: "접근 토큰", revenue: "매출", total_cost: "총비용" };
function valueText(value: unknown): string {
  if (value === null || value === undefined) return "없음";
  if (typeof value === "object" && "truncated" in value && value.truncated) return `${"preview" in value ? String(value.preview) : ""}… (일부만 보관)`;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function ActivityPanel({ mode, defaultDate }: { mode: "changes" | "requests"; defaultDate?: string }) {
  const tab = mode;
  const [source, setSource] = useState("current");
  const defaults = defaultDate ? new URLSearchParams({ from: defaultDate, until: defaultDate, actorType: "user" }).toString() : "";
  const [filters, setFilters] = useState(defaults);
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
    query.set("source", source);
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
  }, [filters, tab, cursor, refresh, source]);
  function reset() { setPage(0); setCursors([""]); setLoading(true); setError(""); }
  return <div className={styles.panel}>
    {mode === "changes" ? <label className={styles.source}>기록<select aria-label="기록 종류" value={source} onChange={e => { setSource(e.target.value); setFilters(""); reset(); }}><option value="current">전체 업무 변경</option><option value="legacy">기존 코치 이력</option></select></label> : null}
    <p className={styles.note}>{tab === "changes" && source === "legacy" ? "기존 코치 관리에 저장된 수정 이력입니다. 당시 기록된 설명을 표시하며, 전체 업무 변경과 같은 작업이 중복될 수 있습니다." : tab === "changes" ? "실제 저장된 변경만 표시합니다. 민감정보와 자유 입력 본문은 변경 여부만 남기며, 같은 요청 ID의 변경은 하나의 API 작업에서 발생했습니다. 보관 기준은 365일입니다." : "요청 횟수는 클릭 수와 다릅니다. 자동 조회와 실패한 요청도 포함하며, 인증 단계에서 차단되어 API에 도달하지 않은 요청은 포함하지 않습니다. 보관 기준은 30일입니다."}</p>
    {source === "legacy" ? <p className={styles.note}>코치 전용 기능에서 저장하던 원본 요약입니다. 통합 이력과 중복될 수 있으며, 이전·이후 값 비교 정보는 없습니다.</p> : null}
    <form key={`${tab}-${source}`} className={styles.filters} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const query = new URLSearchParams();
      for (const [key, value] of data) if (String(value)) query.set(key, String(value));
      setFilters(query.toString()); reset(); setRefresh((value) => value + 1);
    }}>
      <label>사용자 이메일<input name="email" type="search" placeholder="이메일 검색" /></label>
      <label>시작일<input name="from" type="date" defaultValue={defaultDate} /></label>
      <label>종료일<input name="until" type="date" defaultValue={defaultDate} /></label>
      <label>실행 주체<select name="actorType" defaultValue={defaultDate ? "user" : ""}><option value="">전체</option>{Object.entries(actors).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      {tab === "changes" ? <>
        <label>작업<select name="action"><option value="">전체</option>{Object.entries(actions).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>대상<select name="targetType"><option value="">전체</option>{(source === "legacy" ? ["coaches"] : Object.keys(fieldPolicy)).map((key) => <option key={key} value={key}>{targets[key] ?? key}</option>)}</select></label>
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
            <td>{tab === "changes" ? <>{targets[entry.targetType!] ?? entry.targetType} · {actions[entry.action!] ?? entry.action}{entry.targetLabel ? <><br />{entry.targetHref ? <Link href={entry.targetHref}>{entry.targetLabel}</Link> : entry.targetLabel}<small>{entry.labelSource} 기준 이름</small></> : <small>대상 이름 정보 없음 · 상세에서 ID 확인</small>}{entry.description ? <p>{entry.description}</p> : null}</> : <>{entry.method} {entry.route}<small>요청 ID: {entry.id}</small></>}</td>
            <td>{tab === "changes" ? <details><summary>{entry.legacy ? "기록 정보" : `${Object.keys(entry.changes ?? {}).filter(key => !key.endsWith("_id")).length}개 항목 변경`}</summary>
              <p className={styles.metadata}>대상 ID: {entry.targetId}</p>
              <dl>{Object.entries(entry.changes ?? {}).filter(([key]) => !key.endsWith("_id")).map(([key, change]) => <div key={key}><dt>{fields[key] ?? key}</dt><dd>{change.redacted ? "변경됨 (값 미보관)" : <>{valueText(change.before)} → {valueText(change.after)}</>}</dd></div>)}</dl>
              <details><summary>기술 정보</summary><p className={styles.metadata}>요청 ID: {entry.requestId ?? "기존 기록에는 없음"}<br />{entry.method} {entry.route}</p><dl>{Object.entries(entry.changes ?? {}).filter(([key]) => key.endsWith("_id")).map(([key, change]) => <div key={key}><dt>{fields[key] ?? key}</dt><dd>{change.redacted ? "값 미보관" : `${valueText(change.before)} → ${valueText(change.after)}`}</dd></div>)}</dl></details>
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
