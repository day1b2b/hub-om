"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parsePastedRounds, type ParsedRound } from "./parsePastedRounds";

interface BulkAddRoundsButtonProps {
  baseOperationId: string;
  existingRoundNumbers: number[];
}

const PLACEHOLDER_TEXT =
  "1\t2026-03-09\t2026-03-09\t09:30 ~ 17:30\t강사A\t코치A\t서울 강남\n2\t2026-03-16\t2026-03-16\t09:30 ~ 17:30\t강사A\t코치A\t서울 강남";

const TEMPLATE_HEADER = ["회차", "시작일", "종료일", "시간", "강사", "실습코치", "장소"];
const TEMPLATE_SAMPLE_ROW = ["1", "2026-03-09", "2026-03-09", "09:30 ~ 17:30", "강사A", "코치A", "서울 강남"];

export function BulkAddRoundsButton({ baseOperationId, existingRoundNumbers }: BulkAddRoundsButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<ParsedRound[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validCount = useMemo(() => rows.filter((row) => row.errors.length === 0).length, [rows]);
  const pendingCount = useMemo(
    () => rows.filter((row) => row.errors.length === 0 && row.status !== "done").length,
    [rows]
  );

  return (
    <>
      <button className="secondary-action add-round-trigger" onClick={openDialog} type="button">
        + 회차 일괄등록
      </button>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={closeDialog} />
          <section aria-labelledby="bulk-add-rounds-title" className="drive-review-dialog bulk-add-rounds-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="bulk-add-rounds-title">회차 일괄 등록</h2>
                <p>엑셀에서 회차, 시작일, 종료일, 시간, 강사, 실습코치, 장소 순서로 복사해 아래에 붙여넣으세요.</p>
              </div>
              <button aria-label="회차 일괄 등록 닫기" onClick={closeDialog} type="button">
                닫기
              </button>
            </div>

            <div className="bulk-add-rounds-body">
              <div className="bulk-add-rounds-template-row">
                <button className="secondary-action" onClick={downloadTemplate} type="button">
                  양식 다운로드 (엑셀)
                </button>
                <span>양식을 채운 뒤 회차~장소 7개 열을 복사해 아래에 붙여넣으세요.</span>
              </div>

              <label className="bulk-add-rounds-field">
                <span>붙여넣기 (회차 / 시작일 / 종료일 / 시간 / 강사 / 실습코치 / 장소)</span>
                <textarea
                  className="bulk-add-rounds-textarea"
                  onChange={(event) => handlePasteChange(event.target.value)}
                  placeholder={PLACEHOLDER_TEXT}
                  rows={6}
                  value={pasteText}
                />
              </label>

              {rows.length > 0 ? (
                <div className="bulk-add-rounds-preview-wrap">
                  <table className="bulk-add-rounds-preview-table">
                    <thead>
                      <tr>
                        <th>회차</th>
                        <th>시작일</th>
                        <th>종료일</th>
                        <th>시간</th>
                        <th>강사</th>
                        <th>실습코치</th>
                        <th>장소</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr className={row.errors.length > 0 ? "invalid" : undefined} key={`${row.raw}-${index}`}>
                          <td>{row.roundNo || "-"}</td>
                          <td>{row.startDate || "-"}</td>
                          <td>{row.endDate || "-"}</td>
                          <td>{row.timeText || "-"}</td>
                          <td>{row.instructors || "-"}</td>
                          <td>{row.coach || "-"}</td>
                          <td>{row.region || "-"}</td>
                          <td className="bulk-add-rounds-row-status">
                            {row.errors.length > 0 ? row.errors.join(", ") : row.statusMessage || "등록 대기"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="lecture-note-footer">
              {error ? <span className="lecture-note-save-error">{error}</span> : null}
              <span>
                총 {rows.length}행 · 정상 {validCount}행 · 오류 {rows.length - validCount}행
              </span>
              <div className="lecture-note-actions">
                <button disabled={isSaving} onClick={closeDialog} type="button">
                  취소
                </button>
                <button disabled={isSaving || rows.length === 0} onClick={saveAll} type="button">
                  {isSaving ? "등록 중" : `일괄 등록 (${pendingCount}건)`}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );

  function openDialog() {
    setPasteText("");
    setRows([]);
    setIsSaving(false);
    setError(null);
    setIsOpen(true);
  }

  function closeDialog() {
    if (isSaving) return;
    setIsOpen(false);
  }

  function handlePasteChange(value: string) {
    setPasteText(value);
    setRows(parsePastedRounds(value, existingRoundNumbers));
    setError(null);
  }

  function downloadTemplate() {
    const csvBody = [TEMPLATE_HEADER, TEMPLATE_SAMPLE_ROW].map((row) => row.join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csvBody], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "회차_일괄등록_양식.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function saveAll() {
    setError(null);

    if (rows.some((row) => row.errors.length > 0)) {
      setError("오류가 있는 행을 확인해주세요.");
      return;
    }

    setIsSaving(true);

    let hasFailure = false;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];

      if (row.errors.length > 0 || row.status === "done") continue;

      setRows((current) => updateRow(current, index, { status: "saving", statusMessage: "등록 중" }));

      try {
        const response = await fetch(`/api/operations/${encodeURIComponent(baseOperationId)}/rounds`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            coach: row.coach,
            endDate: row.endDate,
            instructors: row.instructors,
            region: row.region,
            roundNo: row.roundNo,
            startDate: row.startDate,
            timeText: row.timeText
          })
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

        if (!response.ok || !payload.ok) {
          hasFailure = true;
          setRows((current) =>
            updateRow(current, index, { status: "failed", statusMessage: payload.error ?? "등록하지 못했습니다." })
          );
          continue;
        }

        setRows((current) => updateRow(current, index, { status: "done", statusMessage: "등록 완료" }));
      } catch {
        hasFailure = true;
        setRows((current) => updateRow(current, index, { status: "failed", statusMessage: "등록하지 못했습니다." }));
      }
    }

    setIsSaving(false);
    router.refresh();

    if (!hasFailure) {
      setIsOpen(false);
    }
  }
}

function updateRow(rows: ParsedRound[], index: number, patch: Partial<ParsedRound>): ParsedRound[] {
  return rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
}
