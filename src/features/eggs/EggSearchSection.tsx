"use client";

import { useMemo, useState } from "react";
import { isValidDate, searchAvailability } from "@/lib/data/eggs/eggAvailability";
import type { EggSearchResult } from "@/lib/data/eggs/eggAvailability";
import type { EggDeviceSummary, EggRentalRecord } from "@/lib/data/eggs/eggTypes";
import { formatRange } from "./eggDisplay";

export interface EggReserveRequest {
  deviceId: string;
  start: string;
  end: string;
}

interface EggSearchSectionProps {
  devices: EggDeviceSummary[];
  rentals: EggRentalRecord[];
  today: string;
  onReserve: (request: EggReserveRequest) => void;
}

/**
 * 기간 조회. 결과를 예약 가능 / 일부 기간만 가능 / 예약 불가 세 구역으로 나눠 보여준다.
 * 일부 가능한 에그는 비어 있는 구간을 눌러 그 날짜로 바로 예약할 수 있다.
 */
export function EggSearchSection({ devices, rentals, today, onReserve }: EggSearchSectionProps) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  /** 두 날짜가 다 들어가면 바로 결과를 보여준다. 조회 버튼을 따로 누르지 않는다. */
  const datesChosen = isValidDate(start) && isValidDate(end);
  const error = datesChosen && end < start ? "반납일이 사용 시작일보다 앞설 수 없습니다." : null;
  const results = useMemo(
    () => (datesChosen && end >= start ? searchAvailability(devices, rentals, start, end, today) : null),
    [datesChosen, start, end, devices, rentals, today]
  );
  const applied = results ? { start, end } : null;

  function reset() {
    setStart("");
    setEnd("");
  }

  const free = results?.filter((item) => item.outcome === "free") ?? [];
  const partial = results?.filter((item) => item.outcome === "partial") ?? [];
  const full = results?.filter((item) => item.outcome === "full") ?? [];

  return (
    <section className="dashboard-panel egg-search">
      <div className="section-title">
        <h2>일정별 가용 에그 찾기</h2>
        <span>{applied ? `${formatRange(applied.start, applied.end)} 기준` : "시작일과 반납일을 고르면 빌릴 수 있는 에그가 바로 나옵니다."}</span>
      </div>

      <div className="egg-search-fields">
        <label>
          <span>사용 시작일</span>
          <input type="date" value={start} min={today} onChange={(event) => setStart(event.target.value)} />
        </label>
        <span className="egg-search-dash" aria-hidden="true">~</span>
        <label>
          <span>반납일</span>
          <input type="date" value={end} min={start || today} onChange={(event) => setEnd(event.target.value)} />
        </label>
        {start || end ? (
          <button type="button" className="egg-text-button" onClick={reset}>
            날짜 지우기
          </button>
        ) : null}
        {error ? <span className="egg-inline-error">{error}</span> : null}
      </div>

      {results && applied ? (
        <div className="egg-result-groups">
          <ResultGroup
            tone="free"
            title="예약 가능"
            items={free}
            empty="전 일정에 사용 가능한 에그가 없습니다."
            render={(item) => (
              <button
                type="button"
                className="secondary-action"
                onClick={() => onReserve({ deviceId: item.device.id, start: applied.start, end: applied.end })}
              >
                이 기간으로 예약
              </button>
            )}
          />
          {partial.length > 0 ? (
            <ResultGroup
              tone="partial"
              title="일부 기간만 가능"
              items={partial}
              render={(item) => (
                <div className="egg-free-ranges">
                  <span>가용 일정:</span>
                  {item.freeRanges.map((range) => (
                    <button
                      type="button"
                      key={range.from}
                      className="secondary-action"
                      onClick={() => onReserve({ deviceId: item.device.id, start: range.from, end: range.to })}
                    >
                      {formatRange(range.from, range.to)} 예약
                    </button>
                  ))}
                </div>
              )}
            />
          ) : null}
          {full.length > 0 ? (
            <ResultGroup tone="full" title="예약 불가" items={full} render={() => null} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

interface ResultGroupProps {
  tone: "free" | "partial" | "full";
  title: string;
  items: EggSearchResult[];
  empty?: string;
  render: (item: EggSearchResult) => React.ReactNode;
}

function ResultGroup({ tone, title, items, empty, render }: ResultGroupProps) {
  return (
    <div className={`egg-result-group egg-result-${tone}`}>
      <h3>
        {title} <span>{items.length}대</span>
      </h3>
      {items.length === 0 ? (
        <p className="dashboard-empty-note">{empty}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.device.id}>
              <div className="egg-result-name">
                <strong>{item.device.label}</strong>
                {item.dataExhausted ? <span className="status egg-muted">데이터 소진</span> : null}
              </div>
              {item.conflicts.length > 0 ? (
                <ul className="egg-conflicts">
                  {item.conflicts.map((rental) => (
                    <li key={rental.id}>
                      {formatRange(rental.startDate, rental.returnDueDate)} · {rental.borrowerName} · {rental.courseName}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="egg-result-action">{render(item)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
