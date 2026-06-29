"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import type { DateRange } from "@/lib/data/coachTypes";
import type { CoachResourceRow } from "@/app/resources/coaches/page";

interface CoachResourceViewProps {
  loadFailed: boolean;
  range: DateRange;
  rows: CoachResourceRow[];
}

export function CoachResourceView({ loadFailed, range, rows }: CoachResourceViewProps) {
  const router = useRouter();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  const totalSlots = rows.reduce((sum, row) => sum + row.schedules.length, 0);
  const availableCoaches = rows.filter((row) => row.schedules.length > 0).length;

  function applyRange(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    router.push(`/resources/coaches?from=${nextFrom}&to=${nextTo}`);
  }

  function applyThisMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    applyRange(formatDate(start), formatDate(end));
  }

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Coach resources" teamScope="both" />

      <section className="content operations-page" id="coach-resources">
        <header className="page-header">
          <div>
            <p className="eyebrow">코치 리소스</p>
            <h1>코치 가용 일정</h1>
            <p className="lede">선택한 기간에 코치별 가용 일정을 조회합니다. 활동중인 코치만 표시합니다.</p>
          </div>
          <div className="header-panel">
            <span>가용 코치</span>
            <strong>{availableCoaches}명</strong>
          </div>
        </header>

        <section className="range-panel operations-range-panel" aria-label="기간 선택">
          <div className="date-range">
            <span>기간</span>
            <input
              aria-label="시작일"
              onChange={(event) => setFrom(event.target.value)}
              type="date"
              value={from}
            />
            <span>~</span>
            <input aria-label="종료일" onChange={(event) => setTo(event.target.value)} type="date" value={to} />
          </div>
          <div className="quick-range" role="group" aria-label="빠른 기간 선택">
            <button onClick={() => applyRange(from, to)} type="button">조회</button>
            <button onClick={applyThisMonth} type="button">이번달</button>
          </div>
        </section>

        <section className="dashboard-panel operations-list-panel">
          <div className="section-title">
            <h2>코치별 가용 일정</h2>
            <div className="dashboard-table-meta">
              <span>{rows.length}명</span>
              <span>가용 {totalSlots}건</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>코치</th>
                  <th>근무유형</th>
                  <th>가용 일정</th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((row, index) => (
                    <tr key={row.id}>
                      <td>{index + 1}</td>
                      <td><strong>{row.name}</strong></td>
                      <td>{row.workType || "-"}</td>
                      <td>
                        {row.schedules.length > 0
                          ? row.schedules
                              .map((schedule) => `${schedule.date} ${schedule.startTime}~${schedule.endTime}`)
                              .join(", ")
                          : "가용 일정 없음"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={4}>
                      <strong>
                        {loadFailed ? "코치 데이터를 불러오지 못했습니다." : "표시할 코치가 없습니다."}
                      </strong>
                      <span>
                        {loadFailed
                          ? "데이터 연결 상태를 확인하세요."
                          : "활동중인 코치가 없거나 선택한 기간에 가용 일정이 없습니다."}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
