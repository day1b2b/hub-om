"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OperationSession } from "@/lib/data/operationTypes";
import { summarizeSatisfactionValue } from "@/lib/data/satisfaction";
import type { StoredDriveImportCandidate, StoredDriveImportResult } from "@/lib/driveImports/driveImportResults";
import type { DriveImportCandidate, DriveImportScanResult } from "@/lib/driveImports/driveImportTypes";

interface DriveImportResultDialogProps {
  operation: OperationSession;
  result: StoredDriveImportResult | null;
}

const ENRICHMENT_FIELDS = new Set([
  "operationDetail",
  "lectureManagementLink",
  "resultReportLink",
  "avgSatisfaction",
  "instructorSatisfaction",
  "instructors"
]);

export function DriveImportResultDialog({ operation, result }: DriveImportResultDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "ready" | "failed">("idle");
  const [scanResult, setScanResult] = useState<DriveImportScanResult | null>(null);
  const [selectedScanIds, setSelectedScanIds] = useState<string[]>([]);
  const [candidateApplyState, setCandidateApplyState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [candidateApplyMessage, setCandidateApplyMessage] = useState("");

  if (!result) {
    return (
      <div className="drive-import-result-trigger empty">
        <div>
          <strong>최근 조회 결과</strong>
          <span>저장된 Drive 조회 결과 없음</span>
        </div>
      </div>
    );
  }

  const candidates = result.keyCandidates.length > 0
    ? result.keyCandidates.slice(0, 12)
    : result.folderCandidates.slice(0, 8);
  const isFolderSearch = result.resultKind.startsWith("folder_search");
  const candidateSummary = isFolderSearch
    ? `상위 ${candidates.length}개 표시 / 전체 ${result.candidateCount}개 후보`
    : `${candidates.length}개 표시 / 전체 ${result.candidateCount}개 후보`;
  const selectedCandidate = selectedIndex === null ? null : candidates[selectedIndex] ?? null;
  const canRegisterSelectedFolder = Boolean(selectedCandidate?.url);
  const enrichmentCandidates = (scanResult?.candidates ?? [])
    .map(normalizeDriveCandidate)
    .filter(isEnrichmentCandidate);
  const selectedEnrichmentCandidates = enrichmentCandidates.filter((candidate) => selectedScanIds.includes(candidate.id));

  return (
    <div className="drive-import-result-trigger">
      <div>
        <strong>최근 조회 결과</strong>
        <span>{driveResultKindLabel(result.resultKind)} · {candidateSummary} · 조회 시각 {formatDateTime(result.runStartedAt)}</span>
      </div>
      <button onClick={() => setIsOpen(true)} type="button">
        결과 보기
      </button>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={() => setIsOpen(false)} />
          <section className="drive-review-dialog drive-import-result-dialog" aria-labelledby="drive-import-result-title">
            <div className="drive-review-header">
              <div>
                <h2 id="drive-import-result-title">Drive 조회 결과</h2>
                <p>{driveResultKindLabel(result.resultKind)} · {candidateSummary} · 조회 시각 {formatDateTime(result.runStartedAt)}</p>
              </div>
              <button aria-label="Drive 조회 결과 닫기" onClick={() => setIsOpen(false)} type="button">
                닫기
              </button>
            </div>

            <div className="drive-import-result-body">
              <div className="drive-import-result-explainer">
                <strong>{isFolderSearch ? "폴더를 확정하려면 아래 후보 중 맞는 폴더를 확인하세요." : "Drive에서 읽어온 값 후보입니다."}</strong>
                <span>
                  {isFolderSearch
                    ? `전체 ${result.candidateCount}개 중 상위 ${candidates.length}개를 점수순으로 표시합니다.`
                    : `${result.fileCount}개 파일에서 ${result.candidateCount}개 후보를 찾았습니다.`}
                </span>
                <small>조회 시각 {formatDateTime(result.runStartedAt)}</small>
              </div>

              {candidates.length > 0 ? (
                <>
                  {isFolderSearch ? (
                    <p className="drive-import-result-note">
                      아래 항목은 폴더명/기업명/기간으로 점수화한 후보입니다. 열 위치에는 의미가 없고, 왼쪽 위부터 점수순으로 표시됩니다.
                    </p>
                  ) : null}
                <div className="drive-import-result-candidates">
                  {candidates.map((candidate, index) => (
                    <DriveImportCandidateCard
                      candidate={candidate}
                      index={index}
                      isFolderSearch={isFolderSearch}
                      key={`${candidate.field ?? candidate.title ?? "candidate"}-${index}`}
                      onSelect={() => setSelectedIndex(index)}
                      selected={selectedIndex === index}
                    />
                  ))}
                </div>
                </>
              ) : (
                <p className="drive-import-result-note">표시할 후보가 없습니다.</p>
              )}

              {result.issues.length > 0 ? (
                <div className="drive-import-result-issues">
                  {result.issues.map((issue, index) => (
                    <span key={`${issue}-${index}`}>{issue}</span>
                  ))}
                </div>
              ) : null}

              {scanState !== "idle" || scanResult ? (
                <section className="drive-import-enrichment">
                  <div className="drive-import-enrichment-header">
                    <div>
                      <strong>폴더 내부 문서 후보</strong>
                      <span>
                        {scanState === "scanning"
                          ? "싱크업/강의관리/결과보고서/만족도 문서를 찾는 중"
                          : `${enrichmentCandidates.length}개 등록 후보`}
                      </span>
                    </div>
                    {enrichmentCandidates.length > 0 ? (
                      <div className="drive-import-enrichment-actions">
                        <button onClick={selectMissingEnrichmentCandidates} type="button">빈 칸만 선택</button>
                        <button onClick={() => setSelectedScanIds(enrichmentCandidates.map((candidate) => candidate.id))} type="button">
                          전체 선택
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {scanState === "failed" ? <p className="drive-import-result-error">{saveMessage || "폴더 내부 문서를 읽지 못했습니다."}</p> : null}
                  {scanState === "ready" && enrichmentCandidates.length === 0 ? (
                    <p className="drive-import-result-note">등록할 문서/만족도 후보를 찾지 못했습니다.</p>
                  ) : null}
                  {enrichmentCandidates.length > 0 ? (
                    <div className="drive-import-enrichment-list">
                      {enrichmentCandidates.map((candidate) => (
                        <label className="drive-import-enrichment-item" key={candidate.id}>
                          <input
                            checked={selectedScanIds.includes(candidate.id)}
                            disabled={!candidate.applyable}
                            onChange={(event) => toggleScanCandidate(candidate.id, event.target.checked)}
                            type="checkbox"
                          />
                          <span>
                            <b>{candidate.label}</b>
                            <strong>{candidate.value}</strong>
                            <small>{candidate.sourceTitle}</small>
                            {candidate.evidence ? <em>{candidate.evidence}</em> : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>

            <div className="drive-import-result-footer">
              <span>
                {candidateApplyMessage ||
                  saveMessage ||
                  (selectedEnrichmentCandidates.length > 0
                    ? `${selectedEnrichmentCandidates.length}개 상세 후보 선택됨`
                    : selectedCandidate
                      ? `${displayDriveCandidateValue(selectedCandidate)} 선택됨`
                      : "등록할 폴더를 선택하세요.")}
              </span>
              <button
                disabled={!canRegisterSelectedFolder || saveState === "saving"}
                onClick={registerSelectedFolder}
                type="button"
              >
                {saveState === "saving" || scanState === "scanning" ? "확인 중" : "이 폴더로 등록"}
              </button>
              {scanResult ? (
                <button
                  disabled={candidateApplyState === "saving" || selectedEnrichmentCandidates.length === 0}
                  onClick={applySelectedEnrichmentCandidates}
                  type="button"
                >
                  {candidateApplyState === "saving" ? "등록 중" : "선택 후보 등록"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );

  async function registerSelectedFolder() {
    if (!selectedCandidate?.url) return;

    setSaveState("saving");
    setSaveMessage("");

    const response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        patches: [
          {
            action: "replace",
            field: "driveLink",
            value: selectedCandidate.url
          }
        ]
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      setSaveMessage(payload.error ?? "Drive 폴더를 등록하지 못했습니다.");
      return;
    }

    setSaveState("saved");
    setSaveMessage("Drive 폴더를 등록했습니다. 내부 문서를 확인합니다.");
    await scanSelectedFolder(selectedCandidate.url);
    setSaveMessage("Drive 폴더를 등록했고 내부 문서 후보를 찾았습니다.");
    router.refresh();
  }

  async function scanSelectedFolder(folderUrl: string) {
    setScanState("scanning");
    setScanResult(null);
    setCandidateApplyMessage("");

    const response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/candidates`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ folderUrl })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; result?: DriveImportScanResult };

    if (!response.ok || !payload.ok || !payload.result) {
      setScanState("failed");
      setSaveMessage(payload.error ?? "폴더 내부 문서를 읽지 못했습니다.");
      return;
    }

    const normalizedResult = {
      ...payload.result,
      candidates: payload.result.candidates.map(normalizeDriveCandidate)
    };
    const nextCandidates = normalizedResult.candidates.filter(isEnrichmentCandidate);

    setScanResult(normalizedResult);
    setSelectedScanIds(nextCandidates.filter((candidate) => !currentFieldValue(operation, candidate.field)).map((candidate) => candidate.id));
    setScanState("ready");
  }

  async function applySelectedEnrichmentCandidates() {
    const patches = selectedEnrichmentCandidates.map((candidate) => ({
      action: candidate.action,
      field: candidate.field,
      value: candidate.value
    }));

    if (patches.length === 0) return;

    setCandidateApplyState("saving");
    setCandidateApplyMessage("");

    const response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ patches })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!response.ok || !payload.ok) {
      setCandidateApplyState("failed");
      setCandidateApplyMessage(payload.error ?? "선택 후보를 등록하지 못했습니다.");
      return;
    }

    setCandidateApplyState("saved");
    setCandidateApplyMessage(`${patches.length}개 상세 후보를 등록했습니다.`);
    setSelectedScanIds([]);
    router.refresh();
  }

  function selectMissingEnrichmentCandidates() {
    setSelectedScanIds(
      enrichmentCandidates
        .filter((candidate) => candidate.applyable && !currentFieldValue(operation, candidate.field))
        .map((candidate) => candidate.id)
    );
  }

  function toggleScanCandidate(candidateId: string, checked: boolean) {
    setSelectedScanIds((current) =>
      checked ? [...current, candidateId] : current.filter((selectedId) => selectedId !== candidateId)
    );
  }
}

function DriveImportCandidateCard({
  candidate,
  index,
  isFolderSearch,
  onSelect,
  selected
}: {
  candidate: StoredDriveImportCandidate;
  index: number;
  isFolderSearch: boolean;
  onSelect: () => void;
  selected: boolean;
}) {
  const label = candidate.field ? driveCandidateFieldLabel(candidate.field) : `폴더 후보 ${index + 1}`;
  const value = displayDriveCandidateValue(candidate);
  const meta = candidate.sourceTitle || folderCandidateMeta(candidate);
  const evidence = candidate.evidence || candidate.reasons?.join(", ") || "";

  return (
    <article className={`drive-import-result-candidate${selected ? " selected" : ""}`}>
      <button className="drive-import-result-select" onClick={onSelect} type="button">
        <span>{label}{isFolderSearch && typeof candidate.score === "number" ? ` · ${candidate.score}점` : ""}</span>
        <strong>{value || "-"}</strong>
        {meta ? <small>{meta}</small> : null}
        {evidence ? <p>{evidence}</p> : null}
        {selected ? <b>선택됨</b> : null}
      </button>
      {candidate.url ? (
        <a className="drive-import-result-open" href={candidate.url} rel="noreferrer" target="_blank">
          폴더 열기
        </a>
      ) : null}
    </article>
  );
}

function displayDriveCandidateValue(candidate: StoredDriveImportCandidate) {
  if (candidate.field === "instructors" && candidate.value === "사내") {
    return "사내강사";
  }

  return candidate.value ?? candidate.title ?? "";
}

function normalizeDriveCandidate(candidate: DriveImportCandidate): DriveImportCandidate {
  if (candidate.field === "instructors" && candidate.value === "사내") {
    return { ...candidate, value: "사내강사" };
  }

  return candidate;
}

function isEnrichmentCandidate(candidate: DriveImportCandidate) {
  return candidate.applyable && ENRICHMENT_FIELDS.has(candidate.field);
}

function currentFieldValue(operation: OperationSession, field: DriveImportCandidate["field"]): string {
  if (field === "companyName" || field === "courseName" || field === "startDate") {
    return String(operation[field] ?? "");
  }

  const value = operation[field];
  if (value === null || value === undefined) return "";
  if (field === "avgSatisfaction" || field === "instructorSatisfaction") {
    return summarizeSatisfactionValue(String(value));
  }

  return String(value);
}

function driveCandidateFieldLabel(field: string) {
  const labels: Record<string, string> = {
    avgSatisfaction: "전체 만족도",
    driveLink: "Drive 링크",
    instructorSatisfaction: "강사 만족도",
    instructors: "강사",
    lectureManagementLink: "강의관리",
    resultReportLink: "결과보고서"
  };

  return labels[field] ?? field;
}

function folderCandidateMeta(candidate: StoredDriveImportCandidate) {
  const parts = [
    candidate.confidence ? `신뢰도 ${confidenceLabel(candidate.confidence)}` : "",
    typeof candidate.score === "number" ? `점수 ${candidate.score}` : ""
  ].filter(Boolean);

  return parts.join(" · ");
}

function confidenceLabel(value: string) {
  const labels: Record<string, string> = {
    high: "높음",
    medium: "보통",
    needs_review: "검토"
  };

  return labels[value] ?? value;
}

function driveResultKindLabel(resultKind: string) {
  const labels: Record<string, string> = {
    error: "오류",
    folder_search_candidates: "폴더 후보",
    folder_search_empty: "후보 없음",
    scan_found_folder: "폴더 확인",
    scan_no_folder: "폴더 미확인"
  };

  return labels[resultKind] ?? resultKind;
}

function formatDateTime(value: string) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}
