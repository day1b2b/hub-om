"use client";

// 계산서 발행 요청 버튼(확인 창)과 발행 요청 현황 배지. 기업위키 상세와 운영현황 교육상세가 같이 쓴다.
import { useState } from "react";

// 링크는 서버(/api/company-wiki/invoice-link)에서 완성된 형태로 받는다 — 구글폼 URL을
// 클라이언트 코드에 두지 않기 위해서다(저장소가 public). undefined는 "아직 불러오는 중",
// null은 "서버가 안전한 URL을 못 만들었음"이고, 화면에서는 둘 다 "-"로 같다.
// 폼이 자동 기입된 채로 열리니, 넘어가기 전에 무엇이 채워지는지 알려 주고 최종 확인을 받는다.
// 확인 창 [구글 설문폼에 자동으로 기입되는 내용] 표 — buildInvoiceRequestFormUrl()이 채우는 항목과 맞춰 둔다.
// [hub-om 항목, 구글 설문폼 항목, 덧붙임 설명]
const INVOICE_REQUEST_FIELD_GROUPS: { label: string; detail?: string; rows: [string, string, string?][] }[] = [
  {
    label: "운영 현황",
    rows: [
      ["코스 ID", "코스 ID"],
      ["코스 ID명", "과정명", "계산서 \"품목명\"에 기재되는 항목"],
      ["기업명", "수강생이름"]
    ]
  },
  {
    label: "기업위키",
    detail: "사업자등록증 정보",
    rows: [
      ["사업자등록번호", "사업자번호"],
      ["상호(법인명)", "회사명"],
      ["대표자", "대표자"],
      ["주소", "주소"],
      ["업태", "업태"],
      ["종목", "종목"]
    ]
  }
];

export function InvoiceRequestLink({ href }: { href: string | null | undefined }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!href) return <span className="muted-inline">-</span>;

  return (
    <>
      <button className="invoice-request-link" onClick={() => setIsOpen(true)} type="button">
        계산서 발행 요청
      </button>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={() => setIsOpen(false)} />
          <section aria-labelledby="invoice-request-confirm-title" className="drive-review-dialog invoice-request-confirm-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="invoice-request-confirm-title">계산서 발행 요청</h2>
              </div>
              <button aria-label="계산서 발행 요청 닫기" onClick={() => setIsOpen(false)} type="button">
                닫기
              </button>
            </div>

            <div className="lecture-note-body invoice-request-confirm-body">
              <p className="invoice-request-confirm-intro">
                기업 위키와 운영 현황에 등록된 정보로 계산서 발행 요청 내용(구글폼)이 자동 기입됩니다.
              </p>
              <p className="invoice-request-confirm-warning">※ 내용이 맞는지 꼭 최종 확인해주세요!</p>
              <strong>[구글 설문폼에 자동으로 기입되는 내용]</strong>
              <table className="invoice-request-confirm-table">
                <thead>
                  <tr>
                    <th colSpan={2} scope="colgroup">운영 허브(Hub-OM) 내용</th>
                    <th scope="col">구글 설문폼 항목</th>
                  </tr>
                </thead>
                <tbody>
                  {INVOICE_REQUEST_FIELD_GROUPS.map((group) =>
                    group.rows.map(([source, target, note], index) => (
                      <tr key={`${group.label}-${source}`}>
                        {index === 0 ? (
                          <th rowSpan={group.rows.length} scope="rowgroup">
                            {group.label}
                            {group.detail ? <span>({group.detail})</span> : null}
                          </th>
                        ) : null}
                        <td>{source}</td>
                        <td>
                          {target}
                          {note ? <span>{note}</span> : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="lecture-note-footer">
              <div className="lecture-note-actions">
                <button onClick={() => setIsOpen(false)} type="button">
                  취소
                </button>
                <a
                  className="invoice-request-confirm-open"
                  href={href}
                  onClick={() => setIsOpen(false)}
                  rel="noreferrer"
                  target="_blank"
                >
                  확인
                </a>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export interface InvoiceRequestStatusView {
  lastRequestedAt: string;
  requestCount: number;
  /** 응답 시트 "발급여부"(재무팀 입력, 예: "발급완료"). 처리 전이면 빈 문자열. */
  issueStatus?: string;
  /** 응답 시트 "발급일자" 원문. */
  issuedAt?: string;
  /** 응답 시트 "실제입금일자" 원문. */
  paidAt?: string;
}

// 폼 응답 시트에 이 코스ID로 들어온 요청이 있으면 재무팀이 적은 "발급여부"를 그대로 보여 주고(발급완료면 초록),
// 아직 비어 있으면 "발급 대기". 코스ID가 없으면 시트와 맞춰 볼 방법이 없어 "-",
// 시트를 못 읽었으면 "미요청"으로 오해하지 않게 "확인 불가"로 둔다.
export function InvoiceRequestStatusBadge({
  hasCourseId,
  state,
  status
}: {
  hasCourseId: boolean;
  state: { available: boolean } | null;
  status: InvoiceRequestStatusView | null;
}) {
  if (!state) return <span className="muted-inline">불러오는 중…</span>;
  if (!hasCourseId) return <span className="muted-inline">-</span>;
  if (!state.available) return <span className="muted-inline" title="계산서 발급 신청 시트를 읽지 못했습니다.">확인 불가</span>;
  if (!status) return <span className="invoice-status invoice-status--pending">미요청</span>;

  const title = `마지막 요청: ${status.lastRequestedAt || "시각 미기재"}${status.requestCount > 1 ? ` · 총 ${status.requestCount}건` : ""}`;
  const issueStatus = status.issueStatus?.trim() ?? "";
  const issued = issueStatus.includes("완료");
  return (
    <span className={`invoice-status ${issued ? "invoice-status--done" : "invoice-status--requested"}`} title={title}>
      {issueStatus || "발급 대기"}{status.requestCount > 1 ? ` (요청 ${status.requestCount}건)` : ""}
    </span>
  );
}

/** 표 칸처럼 좁은 곳에서 배지 아래에 붙이는 발급일·입금일 한 줄. 둘 다 비면 아무것도 안 그린다. */
export function InvoiceIssueDates({ status }: { status: InvoiceRequestStatusView | null }) {
  if (!status || (!status.issuedAt && !status.paidAt)) return null;
  return (
    <span className="invoice-issue-dates">
      {status.issuedAt ? `발급 ${status.issuedAt}` : null}
      {status.issuedAt && status.paidAt ? " · " : null}
      {status.paidAt ? `입금 ${status.paidAt}` : null}
    </span>
  );
}
