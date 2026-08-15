"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parsePastedRounds, type ParsedRound } from "@/features/operations/parsePastedRounds";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

interface OperationCreateFormInitialValues {
  companyName?: string;
  courseId?: string;
  courseName?: string;
  driveLink?: string;
  educationDays?: string;
  endDate?: string;
  instructors?: string;
  onsiteRequired?: string;
  operationDetail?: string;
  region?: string;
  startDate?: string;
  timeText?: string;
}

interface OperationCreateFormProps {
  initialValues?: OperationCreateFormInitialValues;
  personOptions: {
    ld: string[];
    om: string[];
  };
  teamScope: TeamScope;
}

const TEMPLATE_HEADER = ["회차", "시작일", "종료일", "시간", "강사", "실습코치"];
const TEMPLATE_SAMPLE_ROW = ["1", "2026-03-09", "2026-03-09", "09:30 ~ 17:30", "강사A", "코치A"];

type SubmitState = "idle" | "saving" | "failed";

export function OperationCreateForm({ initialValues = {}, personOptions, teamScope }: OperationCreateFormProps) {
  const router = useRouter();
  const ldOptions = useMemo(() => unique(personOptions.ld), [personOptions.ld]);
  const omOptions = useMemo(() => unique(personOptions.om), [personOptions.om]);
  const teamQuery = teamScopeSearchParam(teamScope);

  const [companyName, setCompanyName] = useState(initialValues.companyName ?? "");
  const [courseName, setCourseName] = useState(initialValues.courseName ?? "");
  const [courseId, setCourseId] = useState(initialValues.courseId ?? "");
  const [omNames, setOmNames] = useState<string[]>([""]);
  const [ldNames, setLdNames] = useState<string[]>([""]);
  const [onsiteRequired, setOnsiteRequired] = useState((initialValues.onsiteRequired as string) || "UNKNOWN");
  const [hasResultReport, setHasResultReport] = useState<"Y" | "N">("Y");

  const seedLine = useMemo(() => buildSeedLine(initialValues), [initialValues]);
  const [pasteText, setPasteText] = useState(seedLine);
  const [rows, setRows] = useState<ParsedRound[]>(() => parsePastedRounds(seedLine));
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);

  const validCount = rows.filter((row) => row.errors.length === 0).length;

  return (
    <div className="operation-form">
      <section className="dashboard-panel operation-form-section">
        <div className="section-title">
          <h2>기본 정보</h2>
        </div>
        <div className="operation-form-grid">
          <label>
            <span>기업명</span>
            <input onChange={(event) => setCompanyName(event.target.value)} value={companyName} />
          </label>
          <label>
            <span>코스ID</span>
            <input onChange={(event) => setCourseId(event.target.value)} placeholder="없으면 비워둠" value={courseId} />
          </label>
          <label>
            <span>코스ID명</span>
            <input onChange={(event) => setCourseName(event.target.value)} value={courseName} />
          </label>
          <label>
            <span>현장 투입</span>
            <select onChange={(event) => setOnsiteRequired(event.target.value)} value={onsiteRequired}>
              <option value="UNKNOWN">확인 필요</option>
              <option value="Y">Y</option>
              <option value="N">N</option>
              <option value="PARTIAL">일부 필요</option>
            </select>
          </label>
          <label>
            <span>결과보고서 여부</span>
            <select onChange={(event) => setHasResultReport(event.target.value as "Y" | "N")} value={hasResultReport}>
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          </label>
        </div>
        <div className="operation-form-grid compact">
          <NameSelectList label="OM" nameOptions={omOptions} onChange={setOmNames} values={omNames} />
          <NameSelectList label="LD" nameOptions={ldOptions} onChange={setLdNames} values={ldNames} />
        </div>
      </section>

      <section className="dashboard-panel operation-form-section">
        <div className="section-title">
          <h2>회차 등록</h2>
        </div>

        <div className="bulk-add-rounds-body">
          <div className="bulk-add-rounds-template-row">
            <button className="secondary-action" onClick={downloadTemplate} type="button">
              양식 다운로드 (엑셀)
            </button>
            <span>양식을 채운 뒤 회차~실습코치 6개 열을 복사해 아래에 붙여넣으세요.</span>
          </div>

          <label className="bulk-add-rounds-field">
            <span>붙여넣기 (회차 / 시작일 / 종료일 / 시간 / 강사 / 실습코치)</span>
            <textarea
              className="bulk-add-rounds-textarea"
              onChange={(event) => handlePasteChange(event.target.value)}
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
                      <td className="bulk-add-rounds-row-status">
                        {row.errors.length > 0 ? row.errors.join(", ") : "등록 대기"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <span>총 {rows.length}행 · 정상 {validCount}행 · 오류 {rows.length - validCount}행</span>
        </div>
      </section>

      <div className="operation-form-actions">
        {error ? <span className="lecture-note-save-error">{error}</span> : null}
        <Link className="secondary-action" href={`/operations${teamQuery}`}>취소</Link>
        <button className="primary-action" disabled={submitState === "saving"} onClick={submit} type="button">
          {submitState === "saving" ? "등록 중" : "저장"}
        </button>
      </div>
    </div>
  );

  function handlePasteChange(value: string) {
    setPasteText(value);
    setRows(parsePastedRounds(value));
  }

  function downloadTemplate() {
    const csvBody = [TEMPLATE_HEADER, TEMPLATE_SAMPLE_ROW].map((row) => row.join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csvBody], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "차수_일괄등록_양식.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function submit() {
    setError(null);

    if (!companyName.trim() || !courseName.trim()) {
      setError("기업명과 과정명은 필수입니다.");
      return;
    }

    const validRows = rows.filter((row) => row.errors.length === 0);

    if (validRows.length === 0) {
      setError("회차를 최소 1건 이상 입력해주세요.");
      return;
    }

    setSubmitState("saving");

    const om = omNames.filter(Boolean).join(", ");
    const ld = ldNames.filter(Boolean).join(", ");
    const [firstRound, ...restRounds] = validRows;

    let response: Response;

    try {
      response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coach: firstRound.coach,
          companyName: companyName.trim(),
          courseId: courseId.trim(),
          courseName: courseName.trim(),
          driveLink: initialValues.driveLink,
          educationDays: initialValues.educationDays,
          endDate: firstRound.endDate,
          instructors: firstRound.instructors,
          ld,
          om,
          onsiteRequired,
          operationDetail: initialValues.operationDetail,
          region: initialValues.region,
          roundNo: firstRound.roundNo,
          startDate: firstRound.startDate,
          timeText: firstRound.timeText
        })
      });
    } catch {
      setSubmitState("failed");
      setError("과정을 등록하지 못했습니다.");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; operation?: { operationId: string } };

    if (!response.ok || !payload.ok || !payload.operation) {
      setSubmitState("failed");
      setError(payload.error ?? "과정을 등록하지 못했습니다.");
      return;
    }

    const createdOperationIds = [payload.operation.operationId];

    for (const round of restRounds) {
      let roundResponse: Response;

      try {
        roundResponse = await fetch(`/api/operations/${encodeURIComponent(payload.operation.operationId)}/rounds`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            coach: round.coach,
            endDate: round.endDate,
            instructors: round.instructors,
            roundNo: round.roundNo,
            startDate: round.startDate,
            timeText: round.timeText
          })
        });
      } catch {
        setSubmitState("failed");
        setError(`${round.roundNo}회차를 등록하지 못했습니다.`);
        return;
      }

      const roundPayload = (await roundResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        operation?: { operationId: string };
      };

      if (!roundResponse.ok || !roundPayload.ok || !roundPayload.operation) {
        setSubmitState("failed");
        setError(roundPayload.error ?? `${round.roundNo}회차를 등록하지 못했습니다.`);
        return;
      }

      createdOperationIds.push(roundPayload.operation.operationId);
    }

    if (hasResultReport === "N") {
      for (const operationId of createdOperationIds) {
        await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ patches: [{ field: "hasResultReport", action: "replace", value: "불필요" }] })
        }).catch(() => null);
      }
    }

    router.push(`/operations/${payload.operation.operationId}${teamQuery}`);
  }
}

function buildSeedLine(initialValues: OperationCreateFormInitialValues): string {
  const startDate = initialValues.startDate ?? "";
  const endDate = initialValues.endDate || startDate;

  if (!startDate && !endDate) return "";

  return ["1", startDate, endDate, initialValues.timeText ?? "", initialValues.instructors ?? "", ""].join("\t");
}

function NameSelectList({
  label,
  nameOptions,
  onChange,
  values
}: {
  label: string;
  nameOptions: string[];
  onChange: (values: string[]) => void;
  values: string[];
}) {
  const selectedNames = values.filter(Boolean);

  return (
    <div className="name-select-field">
      <span className="name-select-label">{label}</span>
      <div className="name-select-list">
        {values.map((value, index) => (
          <div className="name-select-row" key={`${label}-${index}`}>
            <select
              aria-label={`${label} ${index + 1}`}
              disabled={nameOptions.length === 0}
              onChange={(event) => updateValue(index, event.target.value)}
              value={value}
            >
              <option value="">{nameOptions.length === 0 ? "선택 가능한 이름 없음" : "선택"}</option>
              {nameOptions.map((name) => (
                <option disabled={selectedNames.includes(name) && name !== value} key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {values.length > 1 ? (
              <button className="name-remove-button" onClick={() => removeValue(index)} type="button">
                삭제
              </button>
            ) : null}
            {index === values.length - 1 ? (
              <button className="name-add-button" disabled={nameOptions.length === 0} onClick={addValue} type="button">
                +
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );

  function addValue() {
    onChange([...values, ""]);
  }

  function removeValue(index: number) {
    onChange(values.filter((_, currentIndex) => currentIndex !== index));
  }

  function updateValue(index: number, value: string) {
    onChange(values.map((currentValue, currentIndex) => (currentIndex === index ? value : currentValue)));
  }
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}
