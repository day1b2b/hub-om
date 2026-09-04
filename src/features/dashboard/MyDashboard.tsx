"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { holidayName } from "./holidays";
import { missingArchiveItems } from "@/lib/data/operationCalculations";
import { buildMyCourseRows } from "./myCourseRows";
import { ALL_RANGE, getMonthRange, overlapsDateRange } from "@/lib/dateRange";
import type { OmNameDiagnosis } from "./omNameDiagnosis";
import { calendarLabel, isOnsiteSupportForViewer } from "./onsiteLabel";
import { createRequestMatcher } from "./requestDedup";
import { requestHref } from "./requestHref";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";
import type { OperationSession, OperationStatus } from "@/lib/data/operationTypes";
import { getSeoulToday } from "@/lib/seoulDate";

interface MyDashboardProps {
  // 로그인 계정이 명단(team-users.json)에 없으면 null.
  omName: null | string;
  // 담당이 0건인 이유(이름 어긋남·이메일 중복). 정상이면 null.
  diagnosis: OmNameDiagnosis | null;
  // 이미 내 담당으로 필터된 운영 목록.
  operations: OperationSession[];
  // 나에게 배정된 OM 운영 요청.
  assignedRequests: OmRequest[];
}

export function MyDashboard({ assignedRequests, diagnosis, omName, operations }: MyDashboardProps) {
  const today = useMemo(() => getSeoulToday(), []);
  // 담당 과정 표의 달 필터. 처음 들어오면 이번 달만 본다 — 과정이 쌓이면 전체는
  // 너무 길어서, 지금 챙길 것부터 보이는 편이 낫다. 칩으로 다른 달을 볼 수 있다.
  // null이면 전체. 연도는 오늘 기준 한 해만 다룬다(아래 courseYear).
  const [selectedMonth, setSelectedMonth] = useState<null | number>(() => today.getMonth());
  const courseYear = today.getFullYear();
  const [openStage, setOpenStage] = useState<null | string>(null);
  // 담당 과정 표 접기/펼치기. 과정이 많으면 화면이 길어져 아래 패널이 멀어진다.
  const [coursesOpen, setCoursesOpen] = useState(true);

  if (!omName) {
    return (
      <main className="dashboard-shell">
        <AppSidebar label="My" teamScope="both" />
        <section className="content dashboard-page">
          <header className="page-header">
            <div>
              <p className="eyebrow">내 대시보드</p>
              <h1>내 대시보드</h1>
              <p className="lede">로그인한 계정이 OM 명단에 등록되어 있지 않습니다.</p>
            </div>
          </header>
          <section className="dashboard-panel">
            <div className="empty-state">
              <strong>명단에 등록된 계정이 아닙니다.</strong>
              <span>관리자에게 OM 명단 등록을 요청하세요. (관리자 전용 → 데이터 관리 → 멤버 관리)</span>
            </div>
          </section>
        </section>
      </main>
    );
  }


  // 밀린 작업 집계는 각 단계의 항목에서 직접 센다(아래 stages 참고).
  // 기간 필터는 걸지 않는다 — 지난달 미완 항목이 숨으면 안 된다.

  // 담당 과정(요청)과 운영은 같은 과정을 양쪽에서 들고 있다. 요청 쪽 표현(차수/세팅 정보)이
  // 더 풍부하므로 요청이 대표하고, 짝이 되는 운영은 제거한다(캘린더·사전세팅에 두 번 뜨지 않게).
  // 짝짓기는 operationId 우선 → courseId. 코스ID를 안 적고 접수한 과정도 자동 생성된 운영의
  // operationId를 갖고 있어서, 코스ID 없이도 대시보드에 정상으로 뜬다. 자세한 규칙은 requestDedup.ts.
  const isRepresentedByRequest = createRequestMatcher(assignedRequests);
  // 캘린더는 운영 + 나의 담당 과정을 모두 반영한다(담당 과정에 새 과정이 추가되면 캘린더에도 자동 표시).
  const calendarEvents: CalendarEvent[] = [
    ...operations.flatMap((operation) => {
      if (isRepresentedByRequest(operation)) return []; // 담당 과정의 차수 이벤트로 대체
      const start = parseDate(operation.startDate);
      const end = parseDate(operation.endDate) ?? start;
      if (!start || !end) return [];
      // 현장운영지원 표기는 "내가 지원자로 들어간 건"에만 붙인다. 담당 OM인 과정에는
      // 현장에 가더라도 붙이지 않는다 — 그 표기의 목적이 담당 과정과의 구별이라서다.
      const onsite = isOnsiteSupportForViewer(operation, omName);
      return [{
        id: `op-${operation.operationId}`,
        label: calendarLabel(operation.companyName, onsite),
        company: operation.companyName,
        course: operation.courseName,
        start: stripTime(start),
        end: stripTime(end),
        href: `/operations/${operation.operationId}`,
        onsite
      }];
    }),
    ...assignedRequests.flatMap((request) => {
      // 교육 일정 차수(세션)를 각 날짜에 개별 표시한다. 세션에 dateEnd가 있으면 그 기간만큼 막대로.
      const multiSession = request.sessions.length > 1;
      // 담당 과정(업무요청)은 내가 담당 OM으로 배정된 건만 모아 온다. 담당이므로
      // 현장운영이 필요한 과정이어도 "_현장운영지원"을 붙이지 않는다.
      const baseLabel = calendarLabel(request.company, false);
      return request.sessions.flatMap((session, index) => {
        const start = parseDate(session.date);
        const end = parseDate(session.dateEnd ?? session.date) ?? start;
        if (!start || !end) return [];
        return [{
          id: `req-${request.id}-${index}`,
          label: multiSession ? `${baseLabel} ${index + 1}차` : baseLabel,
          company: request.company,
          course: request.courseName,
          start: stripTime(start),
          end: stripTime(end),
          href: `/om-request/manage/${request.id}`,
          onsite: false
        }];
      });
    })
  ];

  // 파이프라인: 각 단계에 속한 기업·과정과 해야 할 업무(클릭 시 펼침)를 담는다.
  const phaseOperations = (phase: PipelinePhase) => operations.filter((operation) => operationPhase(operation.operationStatus) === phase);
  const daysToStart = (dateText: string): number | null => {
    const date = parseDate(dateText);
    return date ? daysBetween(today, date) : null;
  };
  // 클릭 시 운영 현황 상세로 보내기 위한 courseId → 운영 id 매핑.
  // 빈 코스ID는 키로 넣지 않는다. ""가 키가 되면 코스ID 없는 운영끼리 서로 덮어써
  // 무관한 운영으로 연결된다.
  const operationIdByCourse = new Map(
    operations
      .filter((operation) => (operation.courseId ?? "").trim() !== "")
      .map((operation) => [(operation.courseId ?? "").trim(), operation.operationId])
  );
  // 담당 과정 표는 업무요청 + 운영현황을 합쳐 전체를 시작일 순으로 보여주고,
  // 선택한 달에 진행되는 줄만 강조한다. 운영현황에서 OM 배정만 된 과정도 표에 떠야 한다.
  const courseRows = buildMyCourseRows(
    assignedRequests,
    operations,
    isRepresentedByRequest,
    scheduleRange,
    (request) => requestHref(request, operationIdByCourse)
  );
  // 표에 실제로 보여 줄 줄. 일정이 없는 줄은 기간과 무관하게 남긴다(overlapsDateRange 참고).
  const courseRange =
    selectedMonth === null ? ALL_RANGE : getMonthRange(new Date(courseYear, selectedMonth, 1), 0);
  // 연간·상시형 과정은 달과 상관없이 남긴다. 시작일이 3월이어도 9월에 챙길 일이 있는데,
  // 달 필터가 숨기면 그 달에 그 과정을 잊는다.
  const visibleCourseRows = courseRows.filter(
    (row) => row.alwaysOn || overlapsDateRange(row.start, row.end, courseRange)
  );

  // 요약 지표는 담당 전체 기준이다. 전에는 선택한 달에 "시작하는" 운영만 세서,
  // 운영 현황에 20건이 잡히는 담당자의 대시보드에 "전체 1"이 떴다.
  // 월 이동은 캘린더와 담당 과정 표의 강조에만 쓴다.
  // 전체 = 바로 아래 담당 과정 표의 줄 수와 같게 맞춘다(두 숫자가 어긋나면 어느 쪽도 못 믿는다).
  const totalCount = courseRows.length;
  const active = operations.filter((operation) => operation.operationStatus === "진행중").length;
  // 예정도 표와 같은 기준(운영 + 짝 없는 담당 과정)으로 센다. 진행상태가 아니라 시작일로 본다.
  const upcoming = courseRows.filter((row) => {
    const start = parseDate(row.start);
    return start ? stripTime(start).getTime() > stripTime(today).getTime() : false;
  }).length;
  const done = operations.filter(isDone).length;

  // 사전세팅 = 강의 시작 전 단계 전체(아직 시작하지 않은 과정). 이전에는 D-7~D-2 창만 봤는데,
  // 그러면 그 창에 든 과정이 없을 때 단계가 비어 보여 실제 준비 상황과 어긋났다.
  // 임박한 순으로 정렬해 위쪽이 먼저 챙길 것이 되게 한다.
  const preRequests = assignedRequests
    .map((request) => ({ request, days: daysToStart(scheduleRange(request).start) }))
    .filter((entry): entry is { request: OmRequest; days: number } => entry.days !== null && entry.days >= 0);
  const preOperations = operations
    // 담당 과정(요청) 항목이 대표 → 짝이 되는 운영은 중복 제거.
    .filter((operation) => !isRepresentedByRequest(operation))
    .map((operation) => ({ operation, days: daysToStart(operation.startDate) }))
    .filter((entry): entry is { operation: OperationSession; days: number } => entry.days !== null && entry.days >= 0);

  const preItems: StageItem[] = [
    ...preRequests.map(({ request, days }) => {
      return {
        id: `r-${request.id}`,
        company: request.company,
        course: request.courseName,
        task: `D-${days} · ${requiredSetupText(request)}`,
        days,
        href: requestHref(request, operationIdByCourse)
      };
    }),
    ...preOperations.map(({ operation, days }) => ({
      id: `o-${operation.operationId}`,
      company: operation.companyName,
      course: operation.courseName,
      task: `D-${days} · 운영 세팅 준비`,
      days,
      href: `/operations/${operation.operationId}`
    }))
  ].sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  // 사전세팅 요약 칩. 예전에는 tasks가 빈 배열이라 과정이 있어도 "챙길 항목 없음"으로만 보였다.
  // 항목마다 이미 세팅 종류를 갖고 있으니 그걸 종류별로 세어 접힌 상태에서도 보이게 한다.
  const countSetup = (predicate: (request: OmRequest) => boolean) =>
    preRequests.filter(({ request }) => predicate(request)).length;
  const hasNamedSetup = (request: OmRequest) =>
    request.skillfloSetup === "Y" ||
    request.skillmatchSetup === "Y" ||
    request.onSiteOperation === "Y" ||
    request.coachRequest === "Y";
  const preSetupTasks = [
    { name: "스킬플로", value: countSetup((request) => request.skillfloSetup === "Y") },
    { name: "스킬매치", value: countSetup((request) => request.skillmatchSetup === "Y") },
    { name: "현장운영", value: countSetup((request) => request.onSiteOperation === "Y") },
    { name: "코치", value: countSetup((request) => request.coachRequest === "Y") },
    // 세팅 종류가 하나도 Y가 아닌 요청. 그래도 기본 준비는 해야 하므로 세어 준다.
    // 이걸 빼면 그런 과정만 있을 때 "1건 · 챙길 항목 없음"이 된다.
    { name: "기본 준비", value: countSetup((request) => !hasNamedSetup(request)) },
    // 요청 없이 운영만 있는 건은 세팅 종류를 알 수 없어 따로 센다.
    { name: "세팅 확인", value: preOperations.length }
  ];
  const fieldItems: StageItem[] = phaseOperations("현장 운영").map((operation) => ({
    id: `o-${operation.operationId}`,
    company: operation.companyName,
    course: operation.courseName,
    task: operation.operationIssue.trim() ? `이슈: ${operation.operationIssue}` : "현장 운영 진행 중",
    href: `/operations/${operation.operationId}`
  }));
  // 결과 단계 = 진행상태가 완료·회고완료·아카이빙필요인 운영 + 아카이빙이 남은 운영.
  // 아카이빙필요는 진행상태와 별개 칼럼(archiveStatus)이라, 진행상태가 아직 배정예정인데
  // 아카이빙만 필요한 건이 생긴다. 그런 건이 결과 항목에 없으면 "아카이빙필요 12건"인데
  // 펼치면 "해당 단계의 과정이 없습니다"가 뜬다. 마감 업무가 남은 건이니 결과에 포함한다.
  const resultOperations = (() => {
    const picked = new Map<string, OperationSession>();
    for (const operation of phaseOperations("결과")) picked.set(operation.operationId, operation);
    for (const operation of operations) {
      if (needsArchiveWork(operation)) picked.set(operation.operationId, operation);
    }
    return [...picked.values()];
  })();
  const resultItems: StageItem[] = resultOperations.map((operation) => ({
    id: `o-${operation.operationId}`,
    company: operation.companyName,
    course: operation.courseName,
    task: resultTaskText(operation),
    href: `/operations/${operation.operationId}`
  }));

  // 칩은 그 단계에 실제로 담긴 운영에서만 센다. 전체에서 세면 항목 수와 어긋나
  // "N건인데 해당 단계의 과정이 없음" 같은 표시가 나온다.
  const fieldOperations = phaseOperations("현장 운영");
  const stages = [
    { label: "사전세팅", items: preItems, tasks: preSetupTasks },
    {
      label: "현장 운영",
      items: fieldItems,
      tasks: [
        { name: "운영이슈", value: fieldOperations.filter((operation) => operation.operationIssue.trim() !== "").length }
      ]
    },
    {
      label: "결과",
      items: resultItems,
      tasks: [
        {
          name: "회고 대기",
          value: resultOperations.filter((operation) => operation.operationStatus === "완료").length
        },
        { name: "아카이빙필요", value: resultOperations.filter(needsArchiveWork).length },
        {
          name: "만족도 미확인",
          value: resultOperations.filter((operation) => isDone(operation) && operation.avgSatisfaction.trim() === "").length
        },
        {
          name: "결과보고서 미확인",
          value: resultOperations.filter((operation) => isDone(operation) && operation.hasResultReport === "확인필요").length
        }
      ]
    }
  ];
  // 다음 과정 D-day: 운영 + 담당 과정을 모두 고려해 임박한 순으로 몇 개를 보여 준다.
  // 하나만 보여 주면 그 과정을 치른 뒤 다음이 무엇인지 캘린더를 뒤져야 했다.
  const nextEvents = findNextEvents(calendarEvents, today, 4);
  const [nextEvent, ...upcomingAfterNext] = nextEvents;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="My" teamScope="both" />

      <section className="content dashboard-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">{formatToday(today)} 기준</p>
            <h1>내 대시보드</h1>
            <p className="lede">{omName}님이 담당한 운영 현황과 지금 챙겨야 할 일을 모아 봅니다.</p>
          </div>
        </header>

        {diagnosis ? <NameMismatchNotice diagnosis={diagnosis} /> : null}

        <section className="metrics" aria-label="내 운영 요약">
          <Metric label="전체" value={totalCount} />
          <Metric label="진행중" value={active} />
          <Metric label="예정" value={upcoming} />
          <Metric label="완료" value={done} />
        </section>

        <section className="dashboard-panel">
          <div className="section-title">
            <h2>
              <button
                aria-expanded={coursesOpen}
                className="panel-toggle"
                onClick={() => setCoursesOpen((open) => !open)}
                type="button"
              >
                나의 담당 과정
                {/* ▲(U+25B2)와 ▼(U+25BC)는 같은 계열이라 크기가 맞는다.
                    ▾(U+25BE)는 "작은 삼각형"이라 아래쪽만 작아 보인다. */}
                <span aria-hidden="true" className="panel-toggle-caret">{coursesOpen ? "▲" : "▼"}</span>
              </button>
            </h2>
            <div className="dashboard-table-meta">
              <span>
                {selectedMonth === null
                  ? `전체 ${courseRows.length}건`
                  : `${courseYear}년 ${selectedMonth + 1}월 ${visibleCourseRows.length}건 · 전체 ${courseRows.length}건`}
              </span>
              {/* 달 칩은 표의 내용을 바꾸는 것이라 접혀 있을 때는 숨긴다. */}
              {coursesOpen ? (
                <div className="quick-range month-chips" role="group" aria-label={`${courseYear}년 달 선택`}>
                  <button
                    className={selectedMonth === null ? "selected" : ""}
                    onClick={() => setSelectedMonth(null)}
                    type="button"
                  >
                    전체
                  </button>
                  {MONTH_INDEXES.map((month) => (
                    <button
                      className={selectedMonth === month ? "selected" : ""}
                      key={month}
                      onClick={() => setSelectedMonth(month)}
                      type="button"
                    >
                      {month + 1}월
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {coursesOpen ? (
          <div className="table-wrap">
            {/* 컬럼 순서·라벨은 운영현황(OperationDashboard) 표를 따른다. 다만 표가 너무 길어져
                교육형태·싱크업·코스ID는 뺐다. OM은 내 대시보드라 항상 본인이어서 뺐고,
                실습코치·만족도·매출은 운영 집계값이라 요청에 없어 제외한다. */}
            <table className="me-course-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>기업</th>
                  <th>과정명</th>
                  <th>총 회차</th>
                  <th>LD</th>
                  <th>시작일</th>
                  <th>종료일</th>
                  <th>강사</th>
                </tr>
              </thead>
              <tbody>
                {visibleCourseRows.length > 0 ? (
                  visibleCourseRows.map((row, index) => (
                    <tr key={row.key}>
                      <td>{index + 1}</td>
                      <td><strong>{row.company}</strong></td>
                      <td>
                        <Link className="course-link" href={row.href}>
                          <strong>{row.courseName}</strong>
                        </Link>
                        {/* 시작일이 다른 달인데 이 달에 떠 있는 이유를 알려 준다.
                            표기가 없으면 필터가 고장난 것으로 읽힌다. */}
                        {row.alwaysOn ? <span className="role-tag">연중</span> : null}
                      </td>
                      <td>{row.totalSessions}</td>
                      <td>{row.ld}</td>
                      <td>{row.start}</td>
                      <td>{row.end}</td>
                      <td>{row.instructor}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={8}>
                      {courseRows.length > 0 ? (
                        <>
                          <strong>{courseYear}년 {(selectedMonth ?? 0) + 1}월에 진행하는 담당 과정이 없습니다.</strong>
                          <span>전체 {courseRows.length}건이 있습니다. 위에서 다른 달이나 전체를 눌러 보세요.</span>
                        </>
                      ) : (
                        <>
                          <strong>배정된 담당 과정이 없습니다.</strong>
                          <span>업무 요청이나 운영 현황에서 담당으로 배정되면 여기에 표시됩니다.</span>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          ) : null}
        </section>

        <section className="dashboard-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <section className="dashboard-panel">
            <div className="section-title">
              <h2>내 운영 파이프라인</h2>
              <span>단계 클릭 시 기업·업무</span>
            </div>
            <div className="stage-list">
              {stages.map((stage) => {
                const openTasks = stage.tasks.filter((task) => task.value > 0);
                const isOpen = openStage === stage.label;
                return (
                  <div className="stage-group" key={stage.label}>
                    <button
                      aria-expanded={isOpen}
                      className="stage-row"
                      onClick={() => setOpenStage(isOpen ? null : stage.label)}
                      type="button"
                    >
                      <div className="stage-head">
                        <strong>{stage.label}</strong>
                        <span className="stage-count">{stage.items.length}건</span>
                        <span className="stage-toggle">{isOpen ? "▲" : "▼"}</span>
                      </div>
                      <div className="stage-tasks">
                        {openTasks.length > 0 ? (
                          openTasks.map((task) => (
                            <span className="stage-task" key={task.name}>{task.name} {task.value}</span>
                          ))
                        ) : (
                          <span className="stage-task-none">챙길 항목 없음</span>
                        )}
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="stage-items">
                        {stage.items.length > 0 ? (
                          stage.items.map((item) => (
                            <a className="stage-item" href={item.href} key={item.id}>
                              <span className="stage-item-course">
                                <strong>{item.company}</strong>
                                <span>{item.course}</span>
                              </span>
                              <span className="stage-item-task">{item.task}</span>
                            </a>
                          ))
                        ) : (
                          <div className="stage-item-empty">해당 단계의 과정이 없습니다.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="section-title">
              <h2>다음 과정 D-day</h2>
              <span>다가오는 예정 과정 {nextEvents.length}건</span>
            </div>
            {nextEvent ? (
              <>
                <div className="dday-card">
                  <strong className="dday-badge">{ddayText(daysBetween(today, nextEvent.start))}</strong>
                  <Link className="course-link" href={nextEvent.href}>
                    <strong>{nextEvent.label}</strong>
                    <span>{nextEvent.course}</span>
                  </Link>
                  <span className="dday-date">{formatDateText(nextEvent.start)} 시작</span>
                </div>
                {/* 두 번째부터는 한 줄씩. 첫 과정만 크게 두어 "가장 임박한 것"이 그대로 눈에 남는다. */}
                {upcomingAfterNext.length > 0 ? (
                  <ul className="dday-next-list">
                    {upcomingAfterNext.map((event) => (
                      <li key={event.id}>
                        <span className="dday-next-badge">{ddayText(daysBetween(today, event.start))}</span>
                        <Link className="course-link" href={event.href}>
                          <strong>{event.label}</strong>
                          <span>{event.course}</span>
                        </Link>
                        <span className="dday-next-date">{formatDateText(event.start)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <PanelEmpty label="예정된 과정이 없습니다" />
            )}
          </section>
        </section>

        <MonthlyCalendar events={calendarEvents} today={today} />
      </section>
    </main>
  );
}

type PipelinePhase = "사전세팅" | "현장 운영" | "결과";

// 진행중 = 현장 운영, 완료·회고완료·아카이빙필요 = 결과.
// 그 외(배정필요·배정예정 등 현장에 나가기 전 단계)는 모두 사전세팅으로 묶는다.
function operationPhase(status: OperationStatus): PipelinePhase {
  if (status === "진행중") return "현장 운영";
  if (status === "완료" || status === "회고완료" || status === "아카이빙필요") return "결과";
  return "사전세팅";
}

interface StageItem {
  id: string;
  company: string;
  course: string;
  task: string;
  href: string;
  /** 시작까지 남은 일수. 사전세팅 정렬용이라 그 단계에만 있다. */
  days?: number;
}

// 사전세팅 단계에서 배정 요청이 준비해야 할 업무(Y로 표시된 세팅). 없으면 기본 준비 문구.
function requiredSetupText(request: OmRequest): string {
  const setups: string[] = [];
  if (request.skillfloSetup === "Y") setups.push("스킬플로");
  if (request.skillmatchSetup === "Y") setups.push("스킬매치");
  if (request.onSiteOperation === "Y") setups.push("현장운영");
  if (request.coachRequest === "Y") setups.push("코치");
  return setups.length > 0 ? `세팅: ${setups.join("·")}` : "사전 세팅 준비";
}

/** 아카이빙이 남았는지. 진행상태와 archiveStatus 두 곳에 나타날 수 있다. */
function needsArchiveWork(operation: OperationSession): boolean {
  return operation.archiveStatus === "아카이빙필요" || operation.operationStatus === "아카이빙필요";
}

// 결과 단계에서 남은 마감 업무.
function resultTaskText(operation: OperationSession): string {
  const tasks: string[] = [];
  if (operation.operationStatus === "완료") tasks.push("회고");
  if (needsArchiveWork(operation)) {
    // "아카이빙"이라고만 쓰면 무엇을 채워야 하는지 몰라 운영 상세를 열어봐야 한다.
    // 판정과 같은 기준(isArchiveComplete)에서 빠진 항목 이름을 뽑아 붙인다.
    const missing = missingArchiveItems({
      courseId: operation.courseId,
      lectureManagementNote: operation.lectureManagementNote,
      avgSatisfaction: operation.avgSatisfaction,
      hasSatisfactionSurvey: operation.hasSatisfactionSurvey,
      hasResultReport: operation.hasResultReport,
      resultReportLink: operation.resultReportLink
    });
    tasks.push(missing.length > 0 ? `아카이빙(${missing.join("·")})` : "아카이빙");
  }
  if (isDone(operation) && operation.avgSatisfaction.trim() === "") tasks.push("만족도");
  if (isDone(operation) && operation.hasResultReport === "확인필요") tasks.push("결과보고서");
  return tasks.length > 0 ? `할 일: ${tasks.join("·")}` : "마감 완료";
}

function PanelEmpty({ label = "표시할 데이터가 없습니다" }: { label?: string }) {
  return (
    <div className="empty-state">
      <strong>{label}</strong>
    </div>
  );
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface CalendarEvent {
  id: string;
  label: string;
  company: string;
  course: string;
  start: Date;
  end: Date;
  href: string;
  /** 현장운영지원 과정. label에 "_현장운영지원"이 붙고, 막대에 테두리도 준다. */
  onsite: boolean;
}

// 기업별로 캘린더 막대 색을 다르게. 같은 기업은 항상 같은 색(이름 해시 기반).
const CALENDAR_COLORS = ["#75976b", "#2d66a6", "#8f5b55", "#655c7c", "#6f5b2b", "#3f8a8f", "#a2734a", "#7a7d34", "#8a5a86", "#5b7fb0"];

function colorForCompany(company: string): string {
  let sum = 0;
  for (let index = 0; index < company.length; index += 1) sum += company.charCodeAt(index);
  return CALENDAR_COLORS[sum % CALENDAR_COLORS.length];
}

// 내 과정이 언제 진행되는지 월별 달력으로 보여준다. 운영과 담당 과정을 모두 반영한다.
// 여러 날에 걸치는 과정은 시작일~종료일까지 칸을 가로지르는 하나의 막대(bar)로 쭉 이어서 표시한다.
function MonthlyCalendar({ events, today }: { events: CalendarEvent[]; today: Date }) {
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));

  const monthStart = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;
  const todayKey = dateKey(stripTime(today));

  const cells = Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - leadingBlanks + 1;
    const date = new Date(view.year, view.month, dayNumber);
    return { date, dayNumber, inMonth: dayNumber >= 1 && dayNumber <= daysInMonth };
  });
  const weeks = Array.from({ length: totalCells / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  function moveMonth(delta: number) {
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <section className="dashboard-panel">
      <div className="section-title">
        <h2>내 과정 일정</h2>
        <div className="me-cal-nav">
          <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button">‹</button>
          <strong>{view.year}년 {view.month + 1}월</strong>
          <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button">›</button>
        </div>
      </div>
      <div className="me-calendar">
        <div className="me-cal-weekdays">
          <div className="me-cal-weeklabel-col" aria-hidden="true" />
          <div className="me-cal-weekday-grid">
            {WEEKDAYS.map((label, index) => (
              <div
                className={["me-cal-weekday", index === 0 ? "is-sun" : "", index === 6 ? "is-sat" : ""].filter(Boolean).join(" ")}
                key={label}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
        {weeks.map((week, weekIndex) => {
          const { bars, laneCount } = buildWeekBars(week, events);
          // 주차 라벨 = 대한민국(ISO 8601) 표준: 그 주의 목요일이 속한 달·주차. (6째주 없음)
          const labelThursday = week[4].date;
          const labelMonth = labelThursday.getMonth() + 1;
          const labelWeek = Math.ceil(labelThursday.getDate() / 7);
          return (
            <div className="me-cal-week" key={weekIndex} style={{ height: Math.max(116, 34 + laneCount * 23) }}>
              <div className="me-cal-weeklabel-col">
                <span>{labelMonth}월</span>
                <span>{labelWeek}째주</span>
              </div>
              <div className="me-cal-week-body">
              <div className="me-cal-week-cells">
                {week.map((cell, cellIndex) => {
                  const dow = cell.date.getDay();
                  const holiday = cell.inMonth ? holidayName(cell.date) : null;
                  const isSun = dow === 0 || Boolean(holiday);
                  const isSat = dow === 6 && !isSun;
                  return (
                    <div
                      className={[
                        "me-cal-day",
                        cell.inMonth ? "" : "is-other-month",
                        cell.inMonth && dateKey(cell.date) === todayKey ? "is-today" : ""
                      ].filter(Boolean).join(" ")}
                      key={cellIndex}
                    >
                      {cell.inMonth ? (
                        <span className="me-cal-daytop">
                          <span
                            className={["me-cal-daynum", isSun ? "is-sun" : "", isSat ? "is-sat" : ""].filter(Boolean).join(" ")}
                          >
                            {cell.dayNumber}
                          </span>
                          {holiday ? <span className="me-cal-holiday" title={holiday}>{holiday}</span> : null}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="me-cal-week-bars">
                {bars.map((bar) => (
                  <a
                    className={[
                      "me-cal-bar",
                      bar.isStart ? "is-start" : "",
                      bar.isEnd ? "is-end" : "",
                      bar.event.onsite ? "is-onsite" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    href={bar.event.href}
                    key={bar.event.id}
                    style={{ gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.lane + 1, background: colorForCompany(bar.event.company) }}
                    title={`${bar.event.label} · ${bar.event.course}`}
                  >
                    {/* 현장운영지원 표기는 label에 들어있다. 막대가 좁아 글자가 잘릴 때를 위해
                        is-onsite 클래스로 테두리도 함께 준다. */}
                    {bar.event.label}
                  </a>
                ))}
              </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// 한 주에서 각 과정이 차지하는 열(시작~끝)과 겹침 방지 레인을 계산한다.
function buildWeekBars(
  week: Array<{ date: Date; dayNumber: number; inMonth: boolean }>,
  events: CalendarEvent[]
) {
  // 보이는 달(inMonth) 셀 범위로만 클리핑 → 앞뒤 달 날짜 칸에는 일정을 표시하지 않는다.
  const monthCells = week.filter((cell) => cell.inMonth);
  if (monthCells.length === 0) return { bars: [], laneCount: 1 };
  const rangeStart = stripTime(monthCells[0].date).getTime();
  const rangeEnd = stripTime(monthCells[monthCells.length - 1].date).getTime();

  const segments = events
    .filter((event) => event.start.getTime() <= rangeEnd && event.end.getTime() >= rangeStart)
    .map((event) => {
      const segStart = Math.max(event.start.getTime(), rangeStart);
      const segEnd = Math.min(event.end.getTime(), rangeEnd);
      return {
        event,
        startCol: week.findIndex((cell) => stripTime(cell.date).getTime() === segStart),
        endCol: week.findIndex((cell) => stripTime(cell.date).getTime() === segEnd),
        isStart: event.start.getTime() >= rangeStart,
        isEnd: event.end.getTime() <= rangeEnd
      };
    })
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));

  const laneEnds: number[] = [];
  const bars = segments.map((segment) => {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= segment.startCol) lane += 1;
    laneEnds[lane] = segment.endCol;
    return { ...segment, lane };
  });

  return { bars, laneCount: Math.max(1, laneEnds.length) };
}

// 배정 요청 세션들에서 처음 시작일과 마지막 종료일을 뽑는다. (날짜가 YYYY-MM-DD라 사전순=시간순)
function scheduleRange(request: OmRequest): { start: string; end: string } {
  const dates = request.sessions.map((session) => session.date).filter(Boolean).sort();
  if (dates.length === 0) return { start: "-", end: "-" };

  return { start: dates[0], end: dates[dates.length - 1] };
}

/**
 * 담당이 0건인 이유를 화면에서 바로 읽게 한다.
 *
 * 전에는 이름이 어긋나 0건인 것과 정말 담당이 없는 것이 똑같이
 * "배정된 담당 과정이 없습니다"로 보여서, 원인을 찾는 데 한참 걸렸다.
 */
function NameMismatchNotice({ diagnosis }: { diagnosis: OmNameDiagnosis }) {
  const duplicated = diagnosis.rosterNamesForEmail.length > 1;

  return (
    <section className="dashboard-panel" aria-label="담당 과정이 0건인 이유">
      <div className="empty-state">
        <strong>
          운영 현황에는 {diagnosis.totalOperations}건이 있는데, &lsquo;{diagnosis.omName}&rsquo; 이름으로 잡힌 과정이 0건입니다.
        </strong>
        <span>
          내 대시보드는 <b>로그인 계정 → 명단의 이름 → 운영 현황 OM 칸</b> 순서로 이어집니다.
          가운데 이름이 운영 현황 표기와 다르면 과정이 많아도 0건으로 보입니다.
        </span>
        {duplicated ? (
          <span>
            <b>이 계정 이메일로 명단 행이 {diagnosis.rosterNamesForEmail.length}개 있습니다:</b>{" "}
            {diagnosis.rosterNamesForEmail.join(", ")} — 나중에 등록된 행의 이름이 적용됩니다.
            관리자 → 멤버 관리에서 중복 행을 지우고 하나만 남겨 주세요.
          </span>
        ) : null}
        {diagnosis.omNamesInOperations.length > 0 ? (
          <span>
            운영 현황 OM 칸에 쓰인 이름: {diagnosis.omNamesInOperations.join(", ")}
          </span>
        ) : null}
        <span>
          관리자 → 멤버 관리에서 내 이름을 운영 현황 OM 표기와 같게 맞추면 바로 보입니다.
        </span>
      </div>
    </section>
  );
}

/** 담당 과정 표의 달 칩. 0 = 1월. */
const MONTH_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isDone(operation: OperationSession) {
  return operation.operationStatus === "완료" || operation.operationStatus === "회고완료";
}

function parseDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function stripTime(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

// 오늘 이후 시작하는 과정(운영 + 담당 과정) 중 가장 임박한 것을 찾는다.
/**
 * 오늘 이후 시작하는 과정(운영 + 담당 과정) 중 임박한 순으로 limit개.
 *
 * 전에는 가장 임박한 하나만 보여 줬는데, 그 하나를 치르면 다음에 무엇이 오는지
 * 캘린더를 뒤져야 했다. 며칠 안에 몰린 과정을 한눈에 보려면 몇 개는 같이 보여야 한다.
 * 같은 날 시작하는 과정이 여러 개면 기업·과정명 순으로 세워 순서가 흔들리지 않게 한다.
 */
function findNextEvents(events: CalendarEvent[], today: Date, limit: number): CalendarEvent[] {
  const todayTime = stripTime(today).getTime();

  return events
    .filter((event) => event.start.getTime() >= todayTime)
    .sort((a, b) => {
      const diff = a.start.getTime() - b.start.getTime();
      if (diff !== 0) return diff;
      const byCompany = a.label.localeCompare(b.label, "ko");
      return byCompany !== 0 ? byCompany : a.course.localeCompare(b.course, "ko");
    })
    .slice(0, limit);
}

/** D-0은 "D-DAY"로 쓴다. 숫자 0은 남은 날이 없다는 뜻으로 잘 안 읽힌다. */
function ddayText(days: number): string {
  return days === 0 ? "D-DAY" : `D-${days}`;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((stripTime(to).getTime() - stripTime(from).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateText(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatToday(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}
