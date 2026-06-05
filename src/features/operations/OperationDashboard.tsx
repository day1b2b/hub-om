"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  OperationChannel,
  OperationSession,
  OperationStatus,
  OperationSummary
} from "@/lib/data/operationTypes";

const FILTERS = [
  "전체",
  "진행중",
  "배정필요",
  "아카이빙필요",
  "회고완료",
  "검토필요"
] as const;

const STATUS_CLASS: Record<OperationStatus, string> = {
  "배정필요": "needs-assignment",
  "배정예정": "planned-assignment",
  "진행중": "active",
  "완료": "done",
  "회고완료": "retrospective-done",
  "아카이빙필요": "archive-needed"
};

const OPERATION_CHANNEL_LABEL: Record<OperationChannel, string> = {
  onsite: "현장",
  live_online: "실시간 온라인",
  online_platform: "온라인 플랫폼",
  blended: "혼합",
  needs_review: "확인 필요"
};

interface OperationDashboardProps {
  operations: OperationSession[];
  summary: OperationSummary;
}

export function OperationDashboard({ operations, summary }: OperationDashboardProps) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("전체");
  const [query, setQuery] = useState("");

  const filteredOperations = useMemo(() => {
    return operations.filter((operation) => {
      const statusMatches =
        filter === "전체" ||
        operation.operationStatus === filter ||
        operation.archiveStatus === filter ||
        (filter === "검토필요" && operation.validationStatus === "검토필요");
      const normalizedQuery = query.trim().toLowerCase();
      const queryMatches =
        !normalizedQuery ||
        [operation.companyName, operation.courseName, operation.courseId, operation.om, operation.ld]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return statusMatches && queryMatches;
    });
  }, [filter, operations, query]);

  return (
    <main className="dashboard-shell">
      <aside className="sidebar" aria-label="hub-om 메뉴">
        <div className="brand">
          <span className="brand-mark">OD</span>
          <div>
            <strong>hub-om</strong>
            <span>DB import mode</span>
          </div>
        </div>
        <nav className="nav-list">
          <a className="active" href="#operations">운영 목록</a>
          <Link href="/admin/imports">데이터 검수</Link>
          <a href="#validation">검토 필요</a>
          <a href="#archive">아카이빙</a>
        </nav>
      </aside>

      <section className="content" id="operations">
        <header className="page-header">
          <div>
            <p className="eyebrow">Repository: Prisma DB adapter</p>
            <h1>운영 차수 현황</h1>
            <p className="lede">
              원천 수집/적재를 거쳐 표준 운영 스키마로 저장된 DB 데이터를 보여줍니다. 화면은 raw 원천 컬럼을 직접 사용하지 않습니다.
            </p>
          </div>
          <div className="header-panel">
            <span>행 기준</span>
            <strong>운영 차수 1개</strong>
          </div>
        </header>

        <section className="metrics" aria-label="운영 요약">
          <Metric label="전체 운영" value={summary.total} />
          <Metric label="진행중" value={summary.active} />
          <Metric label="배정 필요" value={summary.assignmentNeeded} />
          <Metric label="아카이빙 필요" value={summary.archiveNeeded} />
          <Metric label="만족도 미입력" value={summary.missingSatisfaction} />
          <Metric label="결과보고 누락" value={summary.missingResultReport} />
        </section>

        <section className="toolbar" aria-label="운영 목록 필터">
          <div className="segmented" role="group" aria-label="상태 필터">
            {FILTERS.map((item) => (
              <button
                aria-pressed={filter === item}
                className={filter === item ? "selected" : ""}
                key={item}
                onClick={() => setFilter(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
          <label className="search">
            <span>검색</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="기업, 과정, 코스ID, 담당자"
              type="search"
              value={query}
            />
          </label>
        </section>

        <section className="table-section">
          <div className="table-header">
            <h2>운영 목록</h2>
            <span>{filteredOperations.length}건</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>상태</th>
                  <th>기업 / 과정</th>
                  <th>코스ID</th>
                  <th>유형</th>
                  <th>일정</th>
                  <th>담당</th>
                  <th>비용</th>
                  <th>검토</th>
                </tr>
              </thead>
              <tbody>
                {filteredOperations.map((operation) => (
                  <tr key={operation.operationId}>
                    <td>
                      <StatusBadge status={operation.operationStatus} />
                    </td>
                    <td>
                      <strong>{operation.companyName}</strong>
                      <span>{operation.courseName}</span>
                    </td>
                    <td>{operation.courseId || "검토필요"}</td>
                    <td>
                      <strong>{operation.operationType}</strong>
                      <span>채널: {OPERATION_CHANNEL_LABEL[operation.operationChannel]}</span>
                      <span>회차 기간: {operation.sessionDurationType}</span>
                    </td>
                    <td>
                      <strong>{operation.startDate}</strong>
                      <span>
                        {operation.roundNo}회차 · {operation.timeText || "시간 미정"}
                      </span>
                    </td>
                    <td>
                      <strong>{operation.om || "배정필요"}</strong>
                      <span>LD {operation.ld || "미정"}</span>
                    </td>
                    <td>
                      <strong>{formatMoney(operation.totalCost)}</strong>
                      <span>수익 {formatMoney(operation.profit)}</span>
                    </td>
                    <td>
                      {operation.validationErrors.length > 0 ? (
                        <ul className="validation-list">
                          {operation.validationErrors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="ok">정상</span>
                      )}
                    </td>
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: OperationStatus }) {
  return <span className={`status ${STATUS_CLASS[status]}`}>{status}</span>;
}

function formatMoney(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR").format(value);
}
