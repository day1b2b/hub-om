"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PEOPLE_STATUS_LABEL, PEOPLE_STATUS_ORDER, type PeopleStatus } from "@/lib/people/peopleStatus";
import { PeopleAvatar, PeopleStatusPill } from "./PeopleProfile";

// =============================================================================
// 강사 위키·코치 위키 공통 목록
// - 왼쪽 필터(상태·전문분야·보조 필터·섭외 주의) + 위쪽 검색·정렬·보기 전환.
// - 화면마다 데이터는 PeopleRow로 맞춰 넘기고, 필터·정렬·보기는 여기서 똑같이 처리한다.
// =============================================================================

export interface PeopleFlag {
  label: string;
  /** bad = 섭외지양처럼 섭외 전에 꼭 볼 것, warn = 풀 대기처럼 확인할 것. */
  tone: "bad" | "warn";
}

export interface PeopleRow {
  id: string;
  href: string;
  name: string;
  status: PeopleStatus;
  fields: string[];
  flags: PeopleFlag[];
  /** "최근 · 기업 과정 · 10.21"처럼 카드 아래 한 줄. 없으면 subline을 쓴다. */
  recent: string | null;
  subline: string | null;
  /** 정렬용 최근 투입일(YYYY-MM-DD). */
  recentDate: string | null;
  deployCount: number;
  deployLabel: string;
  rating: number | null;
  ratingLabel: string;
  /** 코치 근무일처럼 화면 하나에만 있는 숫자. */
  extra?: { label: string; value: number; text: string };
  /** 보조 필터 값(강사 = 기업, 코치 = 근무유형). */
  secondary: string[];
  searchText: string;
}

type SortKey = "recent" | "deploys" | "rating" | "name" | "extra";

interface PeopleDirectoryProps {
  title: string;
  lede: string;
  rows: PeopleRow[];
  loadFailed: boolean;
  loadFailedText: string;
  emptyText: string;
  searchPlaceholder: string;
  secondaryLabel: string;
  /** 평가 칸 머리글(만족도 / OM 평가). 출처가 달라 화면마다 이름을 붙인다. */
  ratingHeader: string;
  /** 투입 칸 머리글. */
  deployHeader: string;
  extraHeader?: string;
}

const FACET_PREVIEW = 8;

export function PeopleDirectory({
  title,
  lede,
  rows,
  loadFailed,
  loadFailedText,
  emptyText,
  searchPlaceholder,
  secondaryLabel,
  ratingHeader,
  deployHeader,
  extraHeader
}: PeopleDirectoryProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PeopleStatus | "all">("all");
  const [fields, setFields] = useState<Set<string>>(new Set());
  const [secondary, setSecondary] = useState<Set<string>>(new Set());
  const [hideFlagged, setHideFlagged] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");
  const [view, setView] = useState<"card" | "table">("card");

  // 상태·전문분야·보조 필터의 숫자는 검색어만 적용한 결과로 센다. 필터를 골라도 다른 선택지 숫자가 0으로 꺼지지 않게.
  const searched = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((row) => (!keyword || row.searchText.toLowerCase().includes(keyword)) && (!hideFlagged || row.flags.length === 0));
  }, [hideFlagged, query, rows]);

  const filtered = useMemo(
    () =>
      searched
        .filter((row) => status === "all" || row.status === status)
        // 같은 칸 안에서는 하나라도 맞으면 통과(OR). 칸끼리는 모두 맞아야 통과.
        .filter((row) => fields.size === 0 || row.fields.some((field) => fields.has(field)))
        .filter((row) => secondary.size === 0 || row.secondary.some((value) => secondary.has(value)))
        .sort((a, b) => compareRows(a, b, sort)),
    [fields, searched, secondary, sort, status]
  );

  const statusCounts = useMemo(() => countBy(searched.map((row) => [row.status])), [searched]);
  const fieldCounts = useMemo(() => countBy(searched.map((row) => row.fields)), [searched]);
  const secondaryCounts = useMemo(() => countBy(searched.map((row) => row.secondary)), [searched]);
  const flaggedCount = rows.filter((row) => row.flags.length > 0).length;

  const sortOptions: Array<{ value: SortKey; label: string }> = [
    { value: "recent", label: "최근 투입순" },
    { value: "deploys", label: "투입 많은 순" },
    { value: "rating", label: "평가 높은 순" },
    { value: "name", label: "이름순" },
    ...(extraHeader ? [{ value: "extra" as const, label: `${extraHeader} 많은 순` }] : [])
  ];

  return (
    <>
      <header className="page-header people-page-header">
        <div>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
        </div>
      </header>

      <div className="people-directory">
        <aside className="people-facets" aria-label="필터">
          <div className="people-facet">
            <b>상태</b>
            <FacetOption checked={status === "all"} count={searched.length} label="전체" onChange={() => setStatus("all")} type="radio" />
            {PEOPLE_STATUS_ORDER.map((key) => (
              <FacetOption
                checked={status === key}
                count={statusCounts.get(key) ?? 0}
                key={key}
                label={PEOPLE_STATUS_LABEL[key]}
                onChange={() => setStatus(key)}
                type="radio"
              />
            ))}
          </div>
          <CheckFacet counts={fieldCounts} label="전문분야" onToggle={(value) => setFields((prev) => toggle(prev, value))} selected={fields} />
          <CheckFacet counts={secondaryCounts} label={secondaryLabel} onToggle={(value) => setSecondary((prev) => toggle(prev, value))} selected={secondary} />
          <div className="people-facet">
            <b>섭외 주의</b>
            <FacetOption checked={hideFlagged} count={flaggedCount} label="주의 대상 숨기기" onChange={() => setHideFlagged((prev) => !prev)} type="checkbox" />
          </div>
        </aside>

        <div className="people-results">
          <div className="people-toolbar">
            <label className="people-search">
              <span aria-hidden="true">⌕</span>
              <input aria-label={searchPlaceholder} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} type="search" value={query} />
            </label>
            <label className="people-sort">
              <span>정렬</span>
              <select onChange={(event) => setSort(event.target.value as SortKey)} value={sort}>
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="view-toggle">
              <button className={view === "card" ? "selected" : ""} onClick={() => setView("card")} type="button">카드</button>
              <button className={view === "table" ? "selected" : ""} onClick={() => setView("table")} type="button">표</button>
            </div>
            <span className="people-count">총 {filtered.length}명</span>
          </div>

          {loadFailed ? (
            <div className="people-empty"><strong>{loadFailedText}</strong><span>데이터 연결 상태를 확인해 주세요.</span></div>
          ) : filtered.length === 0 ? (
            <div className="people-empty"><strong>{rows.length === 0 ? emptyText : "조건에 맞는 사람이 없습니다."}</strong><span>검색어나 필터를 조정해 보세요.</span></div>
          ) : view === "card" ? (
            <div className="people-rows">
              {filtered.map((row) => (
                <Link className="people-row" href={row.href} key={row.id}>
                  <PeopleAvatar name={row.name} />
                  <span className="people-row-main">
                    <span className="people-row-name">
                      <strong>{row.name}</strong>
                      <PeopleStatusPill status={row.status} />
                      {row.flags.map((flag) => <PeopleFlagPill flag={flag} key={flag.label} />)}
                    </span>
                    {row.fields.length > 0 ? (
                      <span className="people-chips">
                        {row.fields.slice(0, 3).map((field) => <span className="people-chip" key={field}>{field}</span>)}
                        {row.fields.length > 3 ? <span className="people-chip">+{row.fields.length - 3}</span> : null}
                      </span>
                    ) : null}
                    <span className="people-row-recent">{row.recent ?? row.subline ?? "투입 이력 없음"}</span>
                  </span>
                  <span className="people-row-stats">
                    <span><small>{deployHeader}</small><strong>{row.deployLabel}</strong></span>
                    {row.extra ? <span><small>{row.extra.label}</small><strong>{row.extra.text}</strong></span> : null}
                    <span><small>{ratingHeader}</small><strong>{row.ratingLabel}</strong></span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="table-section">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>상태</th>
                      <th>전문분야</th>
                      <th>{deployHeader}</th>
                      {extraHeader ? <th>{extraHeader}</th> : null}
                      <th>최근 투입</th>
                      <th>{ratingHeader}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link className="row-link row-link--logo" href={row.href}>
                            <PeopleAvatar name={row.name} size="sm" />
                            <strong>{row.name}</strong>
                          </Link>
                          {row.flags.map((flag) => <PeopleFlagPill flag={flag} key={flag.label} />)}
                        </td>
                        <td><PeopleStatusPill status={row.status} /></td>
                        <td>{row.fields.length > 0 ? row.fields.join(", ") : <span className="td-muted">-</span>}</td>
                        <td>{row.deployLabel}</td>
                        {extraHeader ? <td>{row.extra?.text ?? "-"}</td> : null}
                        <td>{row.recent ?? <span className="td-muted">-</span>}</td>
                        <td>{row.ratingLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function PeopleFlagPill({ flag }: { flag: PeopleFlag }) {
  return <span className={`people-flag people-flag--${flag.tone}`}>{flag.label}</span>;
}

function FacetOption({
  checked,
  count,
  label,
  onChange,
  type
}: {
  checked: boolean;
  count: number;
  label: string;
  onChange: () => void;
  type: "radio" | "checkbox";
}) {
  return (
    <label className="people-facet-option">
      <input checked={checked} onChange={onChange} type={type} />
      <span>{label}</span>
      <em>{count}</em>
    </label>
  );
}

function CheckFacet({
  counts,
  label,
  onToggle,
  selected
}: {
  counts: Map<string, number>;
  label: string;
  onToggle: (value: string) => void;
  selected: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  // 많은 순으로 보여 주되, 고른 값은 접혀도 항상 보이게 위로 올린다.
  const options = [...counts.entries()]
    .sort((a, b) => Number(selected.has(b[0])) - Number(selected.has(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  const shown = expanded ? options : options.slice(0, Math.max(FACET_PREVIEW, selected.size));

  return (
    <div className="people-facet">
      <b>{label}</b>
      {options.length === 0 ? <span className="td-muted">값 없음</span> : null}
      {shown.map(([value, count]) => (
        <FacetOption checked={selected.has(value)} count={count} key={value} label={value} onChange={() => onToggle(value)} type="checkbox" />
      ))}
      {options.length > shown.length || expanded ? (
        <button className="people-facet-more" onClick={() => setExpanded((prev) => !prev)} type="button">
          {expanded ? "접기" : `+ ${options.length - shown.length}개 더 보기`}
        </button>
      ) : null}
    </div>
  );
}

function compareRows(a: PeopleRow, b: PeopleRow, sort: SortKey): number {
  // 섭외 주의 대상은 어떤 정렬에서도 아래로 보낸다(예전 코치 목록의 "코치 DB 활동중 우선"과 같은 규칙).
  const flagged = Number(a.flags.length > 0) - Number(b.flags.length > 0);
  if (flagged !== 0) return flagged;

  const byName = a.name.localeCompare(b.name, "ko");
  if (sort === "name") return byName;
  if (sort === "deploys") return b.deployCount - a.deployCount || byName;
  if (sort === "rating") return (b.rating ?? -1) - (a.rating ?? -1) || byName;
  if (sort === "extra") return (b.extra?.value ?? 0) - (a.extra?.value ?? 0) || byName;
  // 최근 투입순: 이력 없는 사람은 뒤로, 같은 날이면 투입 많은 순.
  return (b.recentDate ?? "").localeCompare(a.recentDate ?? "") || b.deployCount - a.deployCount || byName;
}

function countBy(groups: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const values of groups) {
    for (const value of new Set(values.filter(Boolean))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function toggle(prev: Set<string>, value: string): Set<string> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
