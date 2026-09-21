"use client";

import Link from "next/link";
import { buildOperationCreateTemplateCsv } from "@/features/operations/operationCreateTemplate";
import { clearOperationSubmission, hasLegacyOperationSubmission, OperationSubmissionValidationError, persistOperationSubmission, readOperationSubmission, submitOperationSnapshot, type OperationSubmission, type OperationSubmissionStore } from "@/features/operations/operationSubmission";
import { operationSubmissionStore } from "@/features/operations/operationSubmissionStore";
import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { useBrowserDraftSession } from "@/components/BrowserDraftProvider";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MultiDateCalendar } from "@/components/MultiDateCalendar";
import { parsePastedRounds, type ParsedRound } from "@/features/operations/parsePastedRounds";
import type { TrainingType } from "@/lib/data/omRequest/omRequestTypes";
import { enumerateDateRange } from "@/lib/data/operationCalculations";
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
  trainingType?: TrainingType;
}

interface OperationCreateFormProps {
  expectedSubject?: string;
  initialValues?: OperationCreateFormInitialValues;
  personOptions: {
    ld: string[];
    om: string[];
  };
  teamScope: TeamScope;
}

const TRAINING_TYPE_OPTIONS: TrainingType[] = ["오프라인", "블렌디드", "비대면", "해커톤"];

type SubmitState = "idle" | "saving" | "failed";

export function OperationCreateForm({ expectedSubject, initialValues = {}, personOptions, teamScope }: OperationCreateFormProps) {
  const router = useRouter();
  const { status, ownerId, generation } = useBrowserDraftSession();
  const [originalOwner, setOriginalOwner] = useState<string | null>(null);
  const draftStore = useMemo(() => status === "ready" && ownerId && expectedSubject && browserDrafts.getSubject() === expectedSubject
    ? operationSubmissionStore(browserDrafts, { status, ownerId, generation }, teamScope, expectedSubject) : null, [status, ownerId, generation, teamScope, expectedSubject]);
  const ldOptions = useMemo(() => unique(personOptions.ld), [personOptions.ld]);
  const omOptions = useMemo(() => unique(personOptions.om), [personOptions.om]);
  const teamQuery = teamScopeSearchParam(teamScope);

  const [companyName, setCompanyName] = useState(initialValues.companyName ?? "");
  const [courseName, setCourseName] = useState(initialValues.courseName ?? "");
  const [courseId, setCourseId] = useState(initialValues.courseId ?? "");
  const [omNames, setOmNames] = useState<string[]>([""]);
  const [ldNames, setLdNames] = useState<string[]>([""]);
  const [trainingType, setTrainingType] = useState<TrainingType>(initialValues.trainingType ?? "오프라인");
  const [onsiteRequired, setOnsiteRequired] = useState((initialValues.onsiteRequired as string) || "N");
  const [hasResultReport, setHasResultReport] = useState<"Y" | "N">("Y");

  const seedLine = useMemo(() => buildSeedLine(initialValues), [initialValues]);
  const [pasteText, setPasteText] = useState(seedLine);
  const [rows, setRows] = useState<ParsedRound[]>(() => parsePastedRounds(seedLine));
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  // 붙여넣은 텍스트의 "실제교육일" 칸을 달력으로 고쳐 쓴 값. 붙여넣기 텍스트를 다시
  // 고치면(handlePasteChange) 초기화되는, 현재 미리보기 한정 보정값이다.
  const [dateOverrides, setDateOverrides] = useState<Record<number, string[]>>({});
  const [openDateEditorIndex, setOpenDateEditorIndex] = useState<number | null>(null);

  const [pendingSubmission, setPendingSubmission] = useState<OperationSubmission | null>(null);
  const [restoredStore, setRestoredStore] = useState<OperationSubmissionStore | null>(null);
  const storageReady = draftStore !== null && restoredStore === draftStore;
  const submittingRef = useRef(false);
  const [legacyRevision, setLegacyRevision] = useState(0);
  useEffect(() => {
    const refreshLegacy = () => setLegacyRevision(value => value + 1);
    window.addEventListener("hub-om:legacy-transition-updated", refreshLegacy);
    window.addEventListener("storage", refreshLegacy);
    return () => {
      window.removeEventListener("hub-om:legacy-transition-updated", refreshLegacy);
      window.removeEventListener("storage", refreshLegacy);
    };
  }, []);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestoredStore(null);
    if (!draftStore) return;
    if (originalOwner && originalOwner !== draftStore.owner) return;
    if (!originalOwner) setOriginalOwner(draftStore.owner);
    async function restore() {
      try {
        if (hasLegacyOperationSubmission(window.sessionStorage) || hasLegacyOperationSubmission(window.localStorage)) {
          throw new Error("서버 반영 여부가 미확정인 이전 등록 정보가 있습니다. 화면 위쪽의 이전 초안 보호 절차를 진행하고 운영 현황을 확인한 뒤 새 등록을 허용해주세요.");
        }
        const pending = await readOperationSubmission(draftStore!, teamScope);
        if (!active) return;
        setPendingSubmission(pending);
        if (pending) {
          const first = pending.payloads[0];
          setCompanyName(first.companyName);
          setCourseName(first.courseName);
          setCourseId(first.courseId ?? "");
          setOmNames(first.om ? first.om.split(", ") : [""]);
          setLdNames(first.ld ? first.ld.split(", ") : [""]);
          setTrainingType(TRAINING_TYPE_OPTIONS.includes(first.trainingType as TrainingType) ? first.trainingType as TrainingType : "오프라인");
          setOnsiteRequired(first.onsiteRequired ?? "N");
          setHasResultReport(pending.hasResultReport);
          const restoredText = pending.payloads.map((body) => [body.roundNo, body.startDate, body.endDate, body.timeText, body.instructors, body.coach, body.region, body.educationDates].map((value) => value ?? "").join("\t")).join("\n");
          setPasteText(restoredText);
          setRows(parsePastedRounds(restoredText));
          setDateOverrides({});
        }
        setRestoredStore(draftStore);
        setError(null);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "암호화된 등록 정보를 확인하지 못했습니다. 기존 정보를 보존하고 저장을 중단했습니다.");
      }
    }
    void restore();
    return () => { active = false; };
  }, [draftStore, teamScope, originalOwner, legacyRevision]);

  const validCount = rows.filter((row) => row.errors.length === 0).length;

  if (!draftStore || (originalOwner !== null && originalOwner !== draftStore.owner)) {
    return <div className="operation-form" role="status">등록 정보를 확인하려면 인터넷에 연결하고 본인 계정으로 로그인해주세요. 이 화면의 입력과 저장된 정보는 삭제하지 않습니다.</div>;
  }

  return (
    <div className="operation-form">
      {pendingSubmission ? (
        <div role="status" className="operation-form-section">
          <p>{pendingSubmission.payloads[0].companyName} · {pendingSubmission.payloads[0].courseName} · {pendingSubmission.payloads.length}개 회차 등록이 진행 중입니다.</p>
          <p>중복 등록을 막기 위해 입력을 잠갔습니다. 원래 등록 계속하기를 누르면 저장된 회차를 확인하고 남은 등록을 이어갑니다. 오류가 반복되면 본인 계정으로 로그인한 뒤 다시 시도하거나 담당자에게 문의해주세요.</p>
        </div>
      ) : null}
      <fieldset disabled={!storageReady || pendingSubmission !== null || submitState === "saving"} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
            <span>과정명</span>
            <input onChange={(event) => setCourseName(event.target.value)} value={courseName} />
          </label>
          <label>
            <span>교육형태</span>
            <select onChange={(event) => setTrainingType(event.target.value as TrainingType)} value={trainingType}>
              {TRAINING_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>현장 투입</span>
            <select onChange={(event) => setOnsiteRequired(event.target.value)} value={onsiteRequired}>
              <option value="Y">Y</option>
              <option value="N">N</option>
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
            <span>양식을 채운 뒤 회차~실제교육일 8개 열을 복사해 아래에 붙여넣으세요.</span>
          </div>

          <label className="bulk-add-rounds-field">
            <span>붙여넣기 (회차 / 시작일 / 종료일 / 시간 / 강사 / 실습코치 / 지역 / 실제교육일(선택))</span>
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
                    <th>실제교육일</th>
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
                      <td className="bulk-add-rounds-education-dates-cell">
                        <span>
                          {dateOverrides[index]
                            ? dateOverrides[index].join(", ")
                            : row.educationDates.length > 0
                              ? row.educationDates.join(", ")
                              : "전체 기간"}
                        </span>
                        <button onClick={() => setOpenDateEditorIndex(index)} type="button">
                          달력에서 고르기
                        </button>
                      </td>
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

      {openDateEditorIndex !== null && rows[openDateEditorIndex] ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={() => setOpenDateEditorIndex(null)} />
          <section aria-labelledby="bulk-round-dates-title" className="drive-review-dialog session-dates-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="bulk-round-dates-title">{rows[openDateEditorIndex].roundNo || openDateEditorIndex + 1}회차 실제 교육일</h2>
                <p>쉬는 날이 있으면 달력에서 해당 날짜만 눌러 빼주세요.</p>
              </div>
              <button aria-label="교육일 선택 닫기" onClick={() => setOpenDateEditorIndex(null)} type="button">
                닫기
              </button>
            </div>
            <div className="lecture-note-body">
              <MultiDateCalendar
                onChange={(dates) => setDateOverrides((current) => ({ ...current, [openDateEditorIndex]: dates }))}
                value={effectiveDatesOf(openDateEditorIndex)}
              />
            </div>
            <div className="lecture-note-footer">
              <div className="lecture-note-actions">
                <button onClick={() => setOpenDateEditorIndex(null)} type="button">
                  확인
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      </fieldset>
      <div className="operation-form-actions">
        {error ? <span className="lecture-note-save-error">{error}</span> : null}
        <Link className="secondary-action" href={`/operations${teamQuery}`}>취소</Link>
        <button className="primary-action" disabled={!storageReady || submitState === "saving"} onClick={submit} type="button">
          {submitState === "saving" ? "등록 중" : pendingSubmission ? "원래 등록 계속하기" : "저장"}
        </button>
      </div>
    </div>
  );

  function handlePasteChange(value: string) {
    setPasteText(value);
    setRows(parsePastedRounds(value));
    setDateOverrides({});
    setOpenDateEditorIndex(null);
  }

  /** 달력에 보여줄 값. 달력으로 고친 적이 있으면 그 값을, 없으면 붙여넣은 실제교육일
   * 텍스트를, 그것도 없으면 시작일~종료일 전체를 미리 선택된 상태로 보여준다. */
  function effectiveDatesOf(index: number): string[] {
    if (dateOverrides[index]) return dateOverrides[index];
    const row = rows[index];
    if (row.educationDates.length > 0) return row.educationDates;
    return enumerateDateRange(row.startDate, row.endDate);
  }

  function downloadTemplate() {
    const csvBody = buildOperationCreateTemplateCsv();
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
    if (!storageReady || !draftStore || submittingRef.current) return;
    const storage = draftStore;
    setError(null);
    if (!pendingSubmission) {
      if (!companyName.trim() || !courseName.trim()) {
        setError("기업명과 과정명은 필수입니다.");
        return;
      }
      if (rows.length === 0 || rows.some((row) => row.errors.length > 0)) {
        setError("회차를 최소 1건 입력하고 오류가 있는 행을 확인해주세요.");
        return;
      }
    }
    submittingRef.current = true;
    setSubmitState("saving");
    try {
      const assertRegistrationCurrent = () => {
        storage.assertCurrent();
        if (hasLegacyOperationSubmission(window.sessionStorage) || hasLegacyOperationSubmission(window.localStorage)) throw new Error("이전 등록의 반영 여부를 먼저 확인해주세요. 현재 등록 정보는 보존했습니다.");
      };
      assertRegistrationCurrent();
      let snapshot = pendingSubmission;
      if (snapshot && (snapshot.owner !== storage.owner || snapshot.expectedSubject !== storage.expectedSubject || snapshot.team !== teamScope)) throw new Error("등록 정보의 계정 또는 팀이 달라 저장을 중단했습니다.");
      if (!snapshot) {
        const payloads = rows.map<Record<string, string>>((round, index) => {
          const common = {
            coach: round.coach,
            educationDates: (dateOverrides[index] ?? round.educationDates).join(", "),
            endDate: round.endDate,
            instructors: round.instructors,
            roundNo: round.roundNo,
            startDate: round.startDate,
            timeText: round.timeText,
            region: round.region || initialValues.region || ""
          };
          return index === 0 ? {
            ...common,
            companyName: companyName.trim(), courseId: courseId.trim(), courseName: courseName.trim(),
            driveLink: initialValues.driveLink ?? "", educationDays: initialValues.educationDays ?? "",
            ld: ldNames.filter(Boolean).join(", "), om: omNames.filter(Boolean).join(", "),
            onsiteRequired, operationDetail: initialValues.operationDetail ?? "", trainingType
          } : common;
        });
        snapshot = { version: 2, owner: storage.owner, expectedSubject: storage.expectedSubject, team: teamScope, id: crypto.randomUUID(), payloads, hasResultReport };
        // 첫 요청 전에 정확한 전송 본문과 키를 보존한다. 실패하면 네트워크 요청을 시작하지 않는다.
        await persistOperationSubmission(storage, snapshot);
        setPendingSubmission(snapshot);
      }
      const operationId = await submitOperationSnapshot(snapshot, fetch, assertRegistrationCurrent);
      await clearOperationSubmission(storage);
      router.push(`/operations/${encodeURIComponent(operationId)}${teamQuery}`);
    } catch (reason) {
      setSubmitState("failed");
      if (reason instanceof OperationSubmissionValidationError) {
        try {
          await clearOperationSubmission(storage);
          setPendingSubmission(null);
          setError(`${reason.message} 아직 등록된 회차가 없습니다. 입력을 수정한 뒤 다시 저장해주세요.`);
        } catch {
          setError("아직 등록되지 않았지만 브라우저의 진행 정보를 정리하지 못했습니다. 이 탭에서 다시 시도해주세요.");
        }
        return;
      }
      setError(reason instanceof Error && reason.name !== "TimeoutError" && reason.name !== "TypeError"
        ? reason.message
        : "응답을 확인하지 못했습니다. 원래 등록 계속하기로 안전하게 다시 시도해주세요.");
    } finally {
      submittingRef.current = false;
    }
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
