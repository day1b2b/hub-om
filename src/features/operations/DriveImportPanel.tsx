"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OperationSession } from "@/lib/data/operationTypes";
import { summarizeSatisfactionValue } from "@/lib/data/satisfaction";
import type {
  DriveImportCandidate,
  DriveImportScanResult
} from "@/lib/driveImports/driveImportTypes";

interface DriveImportPanelProps {
  operation: OperationSession;
}

type ScanState = "idle" | "loading" | "ready" | "failed";
type ApplyState = "idle" | "saving" | "saved" | "failed";

const FIELD_LABELS: Record<string, string> = {
  avgSatisfaction: "전체 만족도",
  coach: "실습코치",
  companyName: "기업명",
  costRaw: "비용 메모",
  courseName: "과정명",
  driveLink: "Drive",
  educationDays: "교육일수/시수",
  instructorCost: "강사비",
  instructorSatisfaction: "강사 만족도",
  instructors: "강사",
  lectureManagementLink: "강의관리",
  operationCost: "운영비",
  operationDetail: "운영상세/싱크업",
  operationIssue: "운영 이슈",
  padletLink: "패들렛",
  region: "지역/장소",
  resultReportLink: "결과보고서",
  specialNotes: "특이사항",
  timeText: "시간",
  totalCost: "총 비용"
};

const CONFIDENCE_LABELS: Record<DriveImportCandidate["confidence"], string> = {
  high: "높음",
  medium: "보통",
  needs_review: "검토"
};

export function DriveImportPanel({ operation }: DriveImportPanelProps) {
  const router = useRouter();
  const [folderUrl, setFolderUrl] = useState(operation.driveLink);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [result, setResult] = useState<DriveImportScanResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [error, setError] = useState("");
  const [applyMessage, setApplyMessage] = useState("");
  const candidates = useMemo(() => result?.candidates ?? [], [result]);
  const applyableCandidates = useMemo(() => candidates.filter((candidate) => candidate.applyable), [candidates]);
  const selectedApplyableCandidates = useMemo(
    () => applyableCandidates.filter((candidate) => selectedIds.includes(candidate.id)),
    [applyableCandidates, selectedIds]
  );

  return (
    <div className="drive-import-panel">
      <div className="drive-import-toolbar">
        <input
          aria-label="Drive 폴더 URL"
          onChange={(event) => setFolderUrl(event.target.value)}
          placeholder="Drive 폴더 URL"
          type="url"
          value={folderUrl}
        />
        <div className="drive-import-actions">
          <a className="drive-import-action secondary" href="https://drive.google.com/drive/my-drive" rel="noreferrer" target="_blank">
            Drive 열기
          </a>
          <button
            className="drive-import-action secondary"
            disabled={applyState === "saving" || !folderUrl.trim()}
            onClick={registerDriveLink}
            type="button"
          >
            링크 등록
          </button>
          <button
            className="drive-import-action primary"
            disabled={scanState === "loading" || !folderUrl.trim()}
            onClick={scanDrive}
            type="button"
          >
            {scanState === "loading" ? "확인 중" : "자료 등록"}
          </button>
        </div>
      </div>

      {error ? <p className="drive-import-error">{error}</p> : null}
      {applyMessage ? <p className={`drive-import-message ${applyState}`}>{applyMessage}</p> : null}

      {result ? (
        <div className="drive-import-summary">
          <span>마지막 확인 {formatDateTime(result.scannedAt)}</span>
          <span>{result.files.length}개 항목 확인</span>
          <span>{candidates.length}개 후보 · {applyableCandidates.length}개 등록 가능</span>
          <button disabled={candidates.length === 0} onClick={() => setIsReviewOpen(true)} type="button">
            후보 목록 열기
          </button>
        </div>
      ) : null}

      {result?.issues.length ? (
        <div className="drive-import-issues">
          {result.issues.map((issue) => (
            <span key={issue}>{issue}</span>
          ))}
        </div>
      ) : null}

      {scanState === "ready" && candidates.length === 0 ? (
        <p className="drive-import-empty">적용할 후보를 찾지 못했습니다.</p>
      ) : null}

      {isReviewOpen && result ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={() => setIsReviewOpen(false)} />
          <section className="drive-review-dialog" aria-labelledby="drive-review-title">
            <div className="drive-review-header">
              <div>
                <h2 id="drive-review-title">Drive 후보 검토</h2>
                <p>{result.folderTitle} · {candidates.length}개 후보</p>
              </div>
              <button aria-label="후보 검토 닫기" onClick={() => setIsReviewOpen(false)} type="button">
                닫기
              </button>
            </div>

            <div className="drive-import-bulk-actions">
              <span>{selectedApplyableCandidates.length}개 선택됨</span>
              <button disabled={applyableCandidates.length === 0} onClick={selectEmptyFields} type="button">
                빈 칸만 선택
              </button>
              <button disabled={selectedIds.length === 0} onClick={() => setSelectedIds([])} type="button">
                선택 해제
              </button>
              <button
                className="drive-import-primary-action"
                disabled={applyState === "saving" || selectedApplyableCandidates.length === 0}
                onClick={applySelectedCandidates}
                type="button"
              >
                {applyState === "saving" ? "등록 중" : "선택 등록"}
              </button>
            </div>

            <div className="drive-candidate-list">
              {candidates.map((candidate) => {
                const editedValue = editedValues[candidate.id] ?? candidate.value;
                const currentValue = currentFieldValue(operation, candidate.field);

                return (
                  <article className="drive-candidate" key={candidate.id}>
                    <div className="drive-candidate-select">
                      <input
                        checked={selectedIds.includes(candidate.id)}
                        disabled={!candidate.applyable}
                        onChange={(event) => toggleCandidate(candidate.id, event.target.checked)}
                        type="checkbox"
                      />
                    </div>
                    <div className="drive-candidate-body">
                      <div className="drive-candidate-heading">
                        <strong>{candidate.label}</strong>
                        <span className={`confidence-badge ${candidate.confidence}`}>
                          {CONFIDENCE_LABELS[candidate.confidence]}
                        </span>
                        {!candidate.applyable ? <span className="reference-badge">참고</span> : null}
                      </div>
                      <div className="drive-candidate-values">
                        <div>
                          <span>현재</span>
                          <p>{currentValue || "미입력"}</p>
                        </div>
                        <label>
                          <span>Drive 후보</span>
                          <textarea
                            disabled={!candidate.applyable}
                            onChange={(event) => updateEditedValue(candidate.id, event.target.value)}
                            rows={candidate.value.length > 90 ? 4 : 2}
                            value={editedValue}
                          />
                        </label>
                      </div>
                      <div className="drive-candidate-meta">
                        <span>{FIELD_LABELS[candidate.field] ?? candidate.field}</span>
                        <span>{candidate.action === "append" ? "기존 값 뒤에 추가" : "값 교체"}</span>
                        <span>{candidate.sourceTitle}</span>
                      </div>
                      {candidate.evidence ? <p className="drive-candidate-evidence">{candidate.evidence}</p> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );

  async function scanDrive() {
    const nextFolderUrl = folderUrl.trim();

    if (!nextFolderUrl) {
      setScanState("failed");
      setError("Drive 폴더 URL을 붙여넣은 뒤 연결해 주세요.");
      return;
    }

    setScanState("loading");
    setApplyState("idle");
    setError("");
    setApplyMessage("");
    setSelectedIds([]);

    const response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/candidates`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        folderUrl: nextFolderUrl
      })
    });
    const payload = (await response.json()) as { ok: boolean; error?: string; result?: DriveImportScanResult };

    if (!response.ok || !payload.ok || !payload.result) {
      setScanState("failed");
      setError(payload.error ?? "Drive 정보를 가져오지 못했습니다.");
      return;
    }

    setResult(payload.result);
    setFolderUrl(payload.result.folderUrl);
    setScanState("ready");
    setIsReviewOpen(payload.result.candidates.length > 0);
  }

  async function applySelectedCandidates() {
    const patches = selectedApplyableCandidates.map((candidate) => ({
      field: candidate.field,
      action: candidate.action,
      value: editedValues[candidate.id] ?? candidate.value
    }));

    if (patches.length === 0) return;

    await applyPatches(patches, `${patches.length}개 항목을 등록했습니다.`);
  }

  async function registerDriveLink() {
    const nextFolderUrl = folderUrl.trim();

    if (!nextFolderUrl) return;

    await applyPatches(
      [{ field: "driveLink", action: "replace", value: nextFolderUrl }],
      "Drive 링크를 등록했습니다."
    );
  }

  async function applyPatches(
    patches: Array<{ field: DriveImportCandidate["field"]; action: DriveImportCandidate["action"]; value: string }>,
    successMessage: string
  ) {
    setApplyState("saving");
    setApplyMessage("");
    setError("");

    const response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ patches })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };

    if (!response.ok || !payload.ok) {
      setApplyState("failed");
      setApplyMessage(payload.error ?? "선택한 항목을 등록하지 못했습니다.");
      return false;
    }

    setApplyState("saved");
    setApplyMessage(successMessage);
    setSelectedIds([]);
    setIsReviewOpen(false);
    router.refresh();
    return true;
  }

  function selectEmptyFields() {
    const emptyCandidateIds = applyableCandidates
      .filter((candidate) => !currentFieldValue(operation, candidate.field))
      .map((candidate) => candidate.id);

    setSelectedIds(emptyCandidateIds);
  }

  function toggleCandidate(candidateId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...current, candidateId] : current.filter((selectedId) => selectedId !== candidateId)
    );
  }

  function updateEditedValue(candidateId: string, value: string) {
    setEditedValues((current) => ({
      ...current,
      [candidateId]: value
    }));
  }
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}
