"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildCoachLinkMailUrl, shortActorName, type CoachLinkMailLogEntry } from "@/lib/coaches/coachLinkMail";

interface ScheduleRegistrationRow {
  id: string;
  name: string;
  workType: string | null;
  coachInputUrl: string | null;
  status: "completed" | "accessedOnly" | "notAccessed";
}

interface ScheduleRegistrationResponse {
  ok: boolean;
  yearMonth?: string;
  counts?: { completed: number; accessedOnly: number; notAccessed: number; total: number };
  coaches?: ScheduleRegistrationRow[];
  error?: string;
}

type FilterKey = "all" | "completed" | "accessedOnly" | "notAccessed";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "전체",
  completed: "입력완료",
  accessedOnly: "접속만",
  notAccessed: "미확인"
};

export function ScheduleLinkPanel() {
  const [yearMonth, setYearMonth] = useState(() => currentYearMonth());
  const [rows, setRows] = useState<ScheduleRegistrationRow[]>([]);
  const [counts, setCounts] = useState({ completed: 0, accessedOnly: 0, notAccessed: 0, total: 0 });
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mailLogs, setMailLogs] = useState<Map<string, CoachLinkMailLogEntry>>(new Map());
  const [mailBusyId, setMailBusyId] = useState<string | null>(null);
  const [noEmailIds, setNoEmailIds] = useState<Set<string>>(new Set());
  const [mailError, setMailError] = useState<string | null>(null);

  const loadMailLogs = useCallback(async () => {
    const response = await fetch("/api/coaches/link-mail-log");
    const payload = (await response.json().catch(() => ({ ok: false }))) as { ok: boolean; logs?: CoachLinkMailLogEntry[] };
    if (response.ok && payload.ok && payload.logs) {
      setMailLogs(new Map(payload.logs.map((log) => [log.coachId, log])));
    }
  }, []);

  useEffect(() => {
    // 기록 칸은 표와 따로 한 번 읽는다(월이 바뀌어도 기록은 같다).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMailLogs();
  }, [loadMailLogs]);

  async function writeLinkMail(row: ScheduleRegistrationRow) {
    if (!row.coachInputUrl || mailBusyId) return;
    // 응답을 기다린 뒤 여는 창은 팝업 차단에 걸리므로, 클릭 순간 빈 탭을 먼저 연다.
    const popup = window.open("", "_blank");
    setMailBusyId(row.id);
    setMailError(null);
    const response = await fetch(`/api/coaches/${row.id}/link-mail`, { method: "POST" });
    const payload = (await response.json().catch(() => ({ ok: false }))) as { ok: boolean; email?: string | null; error?: string };
    setMailBusyId(null);

    if (!response.ok || !payload.ok) {
      popup?.close();
      setMailError(payload.error ?? "이메일을 불러오지 못했습니다.");
      return;
    }
    void loadMailLogs();
    if (!payload.email) {
      popup?.close();
      setNoEmailIds((prev) => new Set(prev).add(row.id));
      return;
    }
    const url = buildCoachLinkMailUrl({ to: payload.email, coachName: row.name, link: row.coachInputUrl });
    if (popup) popup.location.href = url;
    else window.open(url, "_blank");
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/admin/schedule-registration/${yearMonth}`);
      const payload = (await response.json().catch(() => ({ ok: false }))) as ScheduleRegistrationResponse;
      if (cancelled) return;

      if (!response.ok || !payload.ok || !payload.coaches || !payload.counts) {
        setError(payload.error ?? "일정 등록 현황을 불러오지 못했습니다.");
        setIsLoading(false);
        return;
      }

      setRows(payload.coaches);
      setCounts(payload.counts);
      setSelected(new Set());
      setIsLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [yearMonth]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const filterMatches = filter === "all" || row.status === filter;
      const queryMatches = !normalizedQuery || row.name.toLowerCase().includes(normalizedQuery);
      return filterMatches && queryMatches;
    });
  }, [rows, filter, query]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filteredRows.length ? new Set() : new Set(filteredRows.map((row) => row.id))
    );
  }

  return (
    <div className="coach-admin-schedule-link">
      <div className="coach-admin-schedule-month">
        <button onClick={() => setYearMonth((prev) => shiftMonth(prev, -1))} type="button">‹</button>
        <strong>{formatMonthLabel(yearMonth)}</strong>
        <button onClick={() => setYearMonth((prev) => shiftMonth(prev, 1))} type="button">›</button>
      </div>

      {error ? (
        <div className="coach-origin-empty-panel">{error}</div>
      ) : (
        <>
          <div className="coach-admin-schedule-filters">
            {(Object.keys(FILTER_LABEL) as FilterKey[]).map((key) => (
              <button
                className={filter === key ? "selected" : ""}
                key={key}
                onClick={() => setFilter(key)}
                type="button"
              >
                {FILTER_LABEL[key]} ({key === "all" ? counts.total : counts[key]})
              </button>
            ))}
            <span className="coach-origin-toolbar-spacer" />
            <label className="coach-schedule-search">
              <span aria-hidden="true">⌕</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름 검색"
                type="search"
                value={query}
              />
            </label>
          </div>

          {mailError ? <div className="coach-origin-empty-panel">{mailError}</div> : null}

          {isLoading ? (
            <div className="coach-doc-empty"><span>불러오는 중…</span></div>
          ) : filteredRows.length === 0 ? (
            <div className="coach-origin-empty-panel">조건에 맞는 코치가 없습니다.</div>
          ) : (
            <table className="coach-admin-deleted-table">
              <thead>
                <tr>
                  <th>
                    <input
                      checked={selected.size === filteredRows.length && filteredRows.length > 0}
                      onChange={toggleAll}
                      type="checkbox"
                    />
                  </th>
                  <th>이름</th>
                  <th>근무유형</th>
                  <th>등록 상태</th>
                  <th>개인 링크</th>
                  <th>안내 메일</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} type="checkbox" />
                    </td>
                    <td>{row.name}</td>
                    <td>{row.workType || "-"}</td>
                    <td>
                      <span className={`coach-admin-schedule-status ${row.status}`}>{FILTER_LABEL[row.status]}</span>
                    </td>
                    <td>
                      {row.coachInputUrl ? (
                        <a href={row.coachInputUrl} rel="noreferrer" target="_blank">열기</a>
                      ) : (
                        <span className="coach-origin-empty-text">링크 없음</span>
                      )}
                    </td>
                    <td>
                      {row.coachInputUrl ? (
                        <div className="coach-link-mail-cell">
                          <button disabled={mailBusyId !== null} onClick={() => writeLinkMail(row)} type="button">
                            {mailBusyId === row.id ? "여는 중" : mailLogs.has(row.id) ? "다시 쓰기" : "메일 쓰기"}
                          </button>
                          {noEmailIds.has(row.id) ? (
                            <span className="coach-link-mail-warning">등록된 이메일 없음</span>
                          ) : mailLogs.has(row.id) ? (
                            <span className="coach-origin-empty-text">
                              {formatMailLogTime(mailLogs.get(row.id)!.at)} · {shortActorName(mailLogs.get(row.id)!.byEmail)}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="coach-origin-empty-text">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function formatMailLogTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(yearMonth: string, offset: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return `${year}년 ${month}월`;
}
