"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { OperationSession, OperationSummary } from "@/lib/data/operationTypes";

type DashboardScope = "이번달" | "연간";

interface MainDashboardProps {
  operations: OperationSession[];
  summary: OperationSummary;
}

export function MainDashboard({ operations, summary }: MainDashboardProps) {
  const today = useMemo(() => new Date(), []);
  const [scope, setScope] = useState<DashboardScope>("이번달");
  const scopedOperations = useMemo(() => {
    return operations.filter((operation) => (scope === "이번달" ? isSameMonth(operation, today) : isSameYear(operation, today)));
  }, [operations, scope, today]);
  const activeOrUpcoming = scopedOperations
    .filter((operation) => !isEnded(operation, today))
    .sort((a, b) => compareStableText(a.startDate, b.startDate));
  const companyCounts = topCounts(scopedOperations.map((operation) => operation.companyName), 5);
  const omCounts = topCounts(scopedOperations.map((operation) => operation.om || "배정필요"), 5);
  const typeCounts = topCounts(scopedOperations.map((operation) => operation.operationType), 5);
  const formatCounts = topCounts(scopedOperations.map((operation) => operation.educationFormat), 5);
  const monthlyCounts = monthlySeries(operations, today.getFullYear());
  const maxCompanyCount = Math.max(1, ...companyCounts.map((item) => item.count));

  return (
    <main className="dashboard-shell">
      <aside className="sidebar" aria-label="hub-om 메뉴">
        <div className="brand">
          <span className="brand-mark">OD</span>
          <div>
            <strong>hub-om</strong>
            <span>Dashboard</span>
          </div>
        </div>
        <nav className="nav-list">
          <Link className="active" href="/">대시보드</Link>
          <Link href="/operations">운영 현황</Link>
          <Link href="/resources">리소스</Link>
        </nav>
      </aside>

      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">2026.06.09 기준</p>
            <h1>메인 대시보드</h1>
            <p className="lede">전체 운영 규모, 진행 상태, 주요 병목을 먼저 확인하는 리더용 요약 화면입니다.</p>
          </div>
          <div className="header-panel">
            <span>데이터 기준</span>
            <strong>{scope} 현황</strong>
          </div>
        </header>

        <div className="dashboard-tabs" role="group" aria-label="대시보드 범위">
          {(["이번달", "연간"] as DashboardScope[]).map((item) => (
            <button
              aria-pressed={scope === item}
              className={scope === item ? "selected" : ""}
              key={item}
              onClick={() => setScope(item)}
              type="button"
            >
              {item} 현황
            </button>
          ))}
        </div>

        <section className="metrics" aria-label="운영 요약">
          <Metric label="진행중" value={scopedOperations.filter((operation) => operation.operationStatus === "진행중").length} />
          <Metric label="예정" value={scopedOperations.filter((operation) => isUpcoming(operation, today)).length} />
          <Metric label="완료" value={scopedOperations.filter(isDone).length} />
          <Metric label="총 매출" value={formatShortMoney(scopedOperations.reduce((sum, operation) => sum + (operation.revenue ?? 0), 0))} />
          <Metric label="참여 기업" value={new Set(scopedOperations.map((operation) => operation.companyName)).size} />
          <Metric label="전체 과정" value={scope === "이번달" ? scopedOperations.length : summary.total} />
        </section>

        <section className="dashboard-grid">
          <section className="dashboard-panel">
            <div className="section-title">
              <h2>기업별 과정 수</h2>
              <span>막대 클릭 시 과정 표시 예정</span>
            </div>
            <div className="bar-list">
              {companyCounts.map((item) => (
                <div className="bar-row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(item.count / maxCompanyCount) * 100}%` }} />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>OM별 현황</h2>
              <span>담당 운영 수</span>
            </div>
            <CompactList items={omCounts} />
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>운영 유형</h2>
              <span>과정 성격 분포</span>
            </div>
            <DonutChart items={typeCounts} />
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>교육형태 분포</h2>
              <span>오프라인/비대면/혼합</span>
            </div>
            <DonutChart items={formatCounts} />
          </section>
        </section>

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>월별 과정 현황</h2>
            <span>연간 추이</span>
          </div>
          <div className="monthly-bars">
            {monthlyCounts.map((item) => (
              <div className="monthly-bar" key={item.label}>
                <div style={{ height: `${Math.max(8, item.count * 28)}px` }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="table-section">
          <div className="table-header">
            <h2>예정 / 진행 운영</h2>
            <Link href="/operations">전체 보기</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>상태</th>
                  <th>기업 / 과정</th>
                  <th>교육형태</th>
                  <th>OM</th>
                  <th>LD</th>
                  <th>기간</th>
                  <th>매출</th>
                  <th>강사</th>
                </tr>
              </thead>
              <tbody>
                {activeOrUpcoming.slice(0, 10).map((operation) => (
                  <tr key={operation.operationId}>
                    <td>{operation.operationStatus}</td>
                    <td>
                      <Link className="course-link" href={`/operations/${operation.operationId}`}>
                        <strong>{operation.companyName}</strong>
                        <span>{operation.courseName}</span>
                      </Link>
                    </td>
                    <td>{operation.educationFormat}</td>
                    <td>{operation.om || "배정필요"}</td>
                    <td>{operation.ld || "미정"}</td>
                    <td>{operation.startDate} ~ {operation.endDate}</td>
                    <td>{formatShortMoney(operation.revenue ?? 0)}</td>
                    <td>{operation.instructors || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompactList({ items }: { items: Array<{ count: number; label: string }> }) {
  return (
    <div className="compact-list">
      {items.map((item) => (
        <div className="compact-row" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.count}건</strong>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ items }: { items: Array<{ count: number; label: string }> }) {
  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  const colors = ["#245a9f", "#176b4d", "#8a5a00", "#624c9d", "#a33a35"];
  const gradient = items
    .map((item, index) => {
      const previous = items.slice(0, index).reduce((sum, current) => sum + current.count, 0);
      const accumulated = previous + item.count;
      const start = (previous / total) * 100;
      const end = (accumulated / total) * 100;
      return `${colors[index % colors.length]} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="donut-wrap">
      <div className="donut-chart" style={{ background: `conic-gradient(${gradient || "#d7e0ea 0% 100%"})` }} />
      <div className="donut-legend">
        {items.map((item, index) => (
          <span key={item.label}>
            <i style={{ background: colors[index % colors.length] }} />
            {item.label} {item.count}
          </span>
        ))}
      </div>
    </div>
  );
}

function isUpcoming(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getTime() > stripTime(today).getTime() : false;
}

function isEnded(operation: OperationSession, today: Date) {
  const end = parseDate(operation.endDate);
  return end ? end.getTime() < stripTime(today).getTime() : false;
}

function isDone(operation: OperationSession) {
  return operation.operationStatus === "완료" || operation.operationStatus === "회고완료";
}

function isSameMonth(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getFullYear() === today.getFullYear() && start.getMonth() === today.getMonth() : false;
}

function isSameYear(operation: OperationSession, today: Date) {
  const start = parseDate(operation.startDate);
  return start ? start.getFullYear() === today.getFullYear() : false;
}

function parseDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function stripTime(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function topCounts(values: string[], limit: number) {
  const counts = new Map<string, number>();

  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || compareStableText(a.label, b.label))
    .slice(0, limit);
}

function compareStableText(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function monthlySeries(operations: OperationSession[], year: number) {
  return Array.from({ length: 12 }, (_, index) => {
    const label = `${index + 1}월`;
    const count = operations.filter((operation) => {
      const date = parseDate(operation.startDate);
      return date ? date.getFullYear() === year && date.getMonth() === index : false;
    }).length;

    return { count, label };
  });
}

function formatShortMoney(value: number): string {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000) return `${Math.round(value / 10000).toLocaleString("ko-KR")}만`;
  return value.toLocaleString("ko-KR");
}
