"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OperationSession } from "@/lib/data/operationTypes";
import { summarizeSatisfactionValue } from "@/lib/data/satisfaction";
import type {
  DriveImportCandidate,
  DriveFolderSearchCandidate,
  DriveFolderSearchResult,
  DriveImportScanResult
} from "@/lib/driveImports/driveImportTypes";

interface DriveImportPanelProps {
  operation: OperationSession;
}

type ScanState = "idle" | "loading" | "ready" | "failed";
type FolderSearchState = "idle" | "loading" | "ready" | "failed";
type ApplyState = "idle" | "saving" | "saved" | "failed";

interface DriveImportDraft {
  version: 1;
  operationId: string;
  folderUrl: string;
  folderSearchResult: DriveFolderSearchResult | null;
  result: DriveImportScanResult | null;
  selectedIds: string[];
  editedValues: Record<string, string>;
  savedAt: string;
}

const DRIVE_IMPORT_DRAFT_VERSION = 1;
const DRIVE_IMPORT_DRAFT_PREFIX = "hub-om:drive-import-draft:";
const DRIVE_IMPORT_DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24;

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

const BLOCKED_INSTRUCTOR_CANDIDATE_VALUES = new Set([
  "강사",
  "교육",
  "내부",
  "대상",
  "담당",
  "리더",
  "미정",
  "미확정",
  "미팅",
  "생길때",
  "섭외",
  "실습",
  "수업시간",
  "외부",
  "운영",
  "로그",
  "시계",
  "시간",
  "일정",
  "장소",
  "조정을",
  "진행",
  "참여",
  "참여인원",
  "추천",
  "출강",
  "필요",
  "프로필",
  "없어",
  "확인",
  "후보"
]);
const BLOCKED_COURSE_CANDIDATE_VALUES = new Set([
  "강의관리",
  "강의요약",
  "과정정보",
  "교육내용",
  "기본정보",
  "세부교육내용",
  "세부내용",
  "운영조건",
  "운영상세",
  "주요내용"
]);

export function DriveImportPanel({ operation }: DriveImportPanelProps) {
  const router = useRouter();
  const [folderUrl, setFolderUrl] = useState(operation.driveLink);
  const [folderSearchState, setFolderSearchState] = useState<FolderSearchState>("idle");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [folderSearchResult, setFolderSearchResult] = useState<DriveFolderSearchResult | null>(null);
  const [result, setResult] = useState<DriveImportScanResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [isFolderSearchOpen, setIsFolderSearchOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [scanProgressTitle, setScanProgressTitle] = useState("");
  const [error, setError] = useState("");
  const [applyMessage, setApplyMessage] = useState("");
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const shouldPersistDraftRef = useRef(true);
  const candidates = useMemo(() => (result?.candidates ?? []).filter(isVisibleDriveCandidate), [result]);
  const applyableCandidates = useMemo(() => candidates.filter((candidate) => candidate.applyable), [candidates]);
  const selectedApplyableCandidates = useMemo(
    () => applyableCandidates.filter((candidate) => selectedIds.includes(candidate.id)),
    [applyableCandidates, selectedIds]
  );
  const draftStorageKey = useMemo(() => driveImportDraftKey(operation.operationId), [operation.operationId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const draft = readDriveImportDraft(draftStorageKey, operation.operationId);

      if (draft) {
        setFolderUrl(draft.folderUrl);
        setFolderSearchResult(draft.folderSearchResult);
        setResult(draft.result);
        setSelectedIds(draft.selectedIds);
        setEditedValues(draft.editedValues);
        setFolderSearchState(draft.folderSearchResult ? "ready" : "idle");
        setScanState(draft.result ? "ready" : "idle");
        setIsReviewOpen(Boolean(draft.result?.candidates.some(isVisibleDriveCandidate)));
      }

      setHasLoadedDraft(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [draftStorageKey, operation.operationId]);

  useEffect(() => {
    if (!hasLoadedDraft) return;

    if (!shouldPersistDraftRef.current) {
      removeDriveImportDraft(draftStorageKey);
      return;
    }

    const hasDraftContent =
      Boolean(result) ||
      Boolean(folderSearchResult) ||
      selectedIds.length > 0 ||
      Object.keys(editedValues).length > 0 ||
      folderUrl.trim() !== operation.driveLink.trim();

    if (!hasDraftContent) {
      removeDriveImportDraft(draftStorageKey);
      return;
    }

    const savedAt = new Date().toISOString();
    const draft: DriveImportDraft = {
      version: DRIVE_IMPORT_DRAFT_VERSION,
      operationId: operation.operationId,
      folderUrl,
      folderSearchResult,
      result,
      selectedIds,
      editedValues,
      savedAt
    };

    writeDriveImportDraft(draftStorageKey, draft);
  }, [
    draftStorageKey,
    editedValues,
    folderSearchResult,
    folderUrl,
    hasLoadedDraft,
    operation.driveLink,
    operation.operationId,
    result,
    selectedIds
  ]);

  return (
    <div className="drive-import-panel">
      <div className="drive-import-toolbar">
        <input
          aria-label="Drive 폴더 URL"
          onChange={(event) => updateFolderUrl(event.target.value)}
          placeholder="Drive 폴더 URL"
          type="url"
          value={folderUrl}
        />
        <div className="drive-import-actions">
          <button
            className="drive-import-action secondary"
            disabled={folderSearchState === "loading" || scanState === "loading"}
            onClick={searchDriveFolders}
            type="button"
          >
            {folderSearchState === "loading" ? "검색 중" : "폴더 후보 찾기"}
          </button>
          <button
            className="drive-import-action primary"
            disabled={scanState === "loading" || !folderUrl.trim()}
            onClick={() => scanDrive()}
            type="button"
          >
            {scanState === "loading" ? "확인 중" : "입력한 폴더 확인"}
          </button>
        </div>
      </div>

      {error ? <p className="drive-import-error">{error}</p> : null}
      {applyMessage ? <p className={`drive-import-message ${applyState}`}>{applyMessage}</p> : null}

      {result ? (
        <div className="drive-import-summary">
          <button disabled={candidates.length === 0} onClick={() => setIsReviewOpen(true)} type="button">
            {candidates.length > 0 ? `${applyableCandidates.length}개 후보 확인` : "후보 없음"}
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

      {isFolderSearchOpen && folderSearchResult ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={() => setIsFolderSearchOpen(false)} />
          <section className="drive-review-dialog folder-search-dialog" aria-labelledby="drive-folder-search-title">
            <div className="drive-review-header">
              <div>
                <h2 id="drive-folder-search-title">Drive 폴더 선택</h2>
                <p>{operation.companyName} · {folderSearchResult.candidates.length}개 후보 · {formatDateTime(folderSearchResult.searchedAt)}</p>
              </div>
              <button aria-label="Drive 폴더 선택 닫기" onClick={() => setIsFolderSearchOpen(false)} type="button">
                닫기
              </button>
            </div>

            <div className="drive-folder-candidate-list modal-list">
              {folderSearchResult.candidates.map((candidate) => {
                const isCompanyMismatch = candidate.companyMatched === false;

                return (
                  <article
                    className={`drive-folder-candidate${isCompanyMismatch ? " company-mismatch" : ""}`}
                    key={candidate.folderId}
                  >
                    <div>
                      <strong>{candidate.title}</strong>
                      <div className="drive-folder-candidate-meta-line">
                        <span>{candidate.score}점 · {candidate.reasons.join(", ") || "검토 필요"}</span>
                        {isCompanyMismatch ? <b className="folder-candidate-badge mismatch">기업명 확인</b> : null}
                        {!isCompanyMismatch && candidate.confidence === "high" ? (
                          <b className="folder-candidate-badge recommended">추천</b>
                        ) : null}
                      </div>
                      {candidate.ownerNames.length > 0 ? <small>소유자 {candidate.ownerNames.join(", ")}</small> : null}
                    </div>
                    <div className="drive-folder-candidate-actions">
                      <a href={candidate.url ?? `https://drive.google.com/drive/folders/${candidate.folderId}`} rel="noreferrer" target="_blank">
                        폴더 열기
                      </a>
                      <button onClick={() => selectFolderCandidate(candidate)} type="button">
                        선택
                      </button>
                    </div>
                  </article>
                );
              })}
              {folderSearchResult.candidates.length === 0 ? (
                <p className="drive-import-empty">Drive 폴더 후보를 찾지 못했습니다.</p>
              ) : null}
              {folderSearchResult.issues.length > 0 ? (
                <div className="drive-import-issues">
                  {folderSearchResult.issues.map((issue) => (
                    <span key={issue}>{issue}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>
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
                빈 칸 선택
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
                        <span>{candidateActionLabel(candidate, currentValue)}</span>
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

      {scanState === "loading" && scanProgressTitle ? (
        <div aria-live="polite" aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" />
          <section className="drive-scan-progress-dialog" aria-label="Drive 자료 확인 중">
            <span className="drive-scan-spinner" />
            <div>
              <strong>Drive 자료 확인 중</strong>
              <p>{scanProgressTitle}</p>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );

  async function scanDrive(nextUrl?: string, progressTitle?: string) {
    shouldPersistDraftRef.current = true;
    const nextFolderUrl = (nextUrl ?? folderUrl).trim();

    if (!nextFolderUrl) {
      setScanState("failed");
      setError("Drive 폴더 URL을 붙여넣은 뒤 연결해 주세요.");
      return;
    }

    setScanState("loading");
    setScanProgressTitle(progressTitle ?? "");
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
      setScanProgressTitle("");
      setError(payload.error ?? "Drive 정보를 가져오지 못했습니다.");
      return;
    }

    const normalizedResult = normalizeDriveImportScanResult(payload.result);
    const visibleCandidates = normalizedResult.candidates.filter(isVisibleDriveCandidate);
    const emptyFieldCandidateIds = visibleCandidates
      .filter((candidate) => candidate.applyable && !currentFieldValue(operation, candidate.field))
      .map((candidate) => candidate.id);

    setResult(normalizedResult);
    setFolderUrl(normalizedResult.folderUrl);
    setSelectedIds(emptyFieldCandidateIds);
    setScanState("ready");
    setScanProgressTitle("");
    setIsReviewOpen(payload.result.candidates.some(isVisibleDriveCandidate));
  }

  async function searchDriveFolders() {
    shouldPersistDraftRef.current = true;
    setFolderSearchState("loading");
    setError("");
    setApplyMessage("");

    const response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/folders`, {
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; result?: DriveFolderSearchResult };

    if (!response.ok || !payload.ok || !payload.result) {
      setFolderSearchState("failed");
      setError(payload.error ?? "Drive 폴더 후보를 찾지 못했습니다.");
      return;
    }

    setFolderSearchResult(payload.result);
    setFolderSearchState("ready");
    setIsFolderSearchOpen(true);
  }

  async function selectFolderCandidate(candidate: DriveFolderSearchCandidate) {
    const nextFolderUrl = candidate.url ?? `https://drive.google.com/drive/folders/${candidate.folderId}`;
    setFolderUrl(nextFolderUrl);
    setIsFolderSearchOpen(false);
    await scanDrive(nextFolderUrl, candidate.title);
  }

  async function applySelectedCandidates() {
    const patches = selectedApplyableCandidates.map((candidate) => ({
      field: candidate.field,
      action: candidate.action,
      value: editedValues[candidate.id] ?? candidate.value
    }));

    if (patches.length === 0) return;

    await applyPatches(patches);
  }

  async function applyPatches(
    patches: Array<{ field: DriveImportCandidate["field"]; action: DriveImportCandidate["action"]; value: string }>
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
    setApplyMessage("");
    shouldPersistDraftRef.current = false;
    setSelectedIds([]);
    setEditedValues({});
    setIsReviewOpen(false);
    removeDriveImportDraft(draftStorageKey);
    router.refresh();
    await refreshCurrentFolderScan();
    return true;
  }

  async function refreshCurrentFolderScan() {
    const nextFolderUrl = folderUrl.trim() || result?.folderUrl.trim() || operation.driveLink.trim();
    if (!nextFolderUrl) return;

    const response = await fetch(`/api/operations/${encodeURIComponent(operation.operationId)}/drive-import/candidates`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ folderUrl: nextFolderUrl })
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: DriveImportScanResult };

    if (!response.ok || !payload.ok || !payload.result) return;

    const normalizedResult = normalizeDriveImportScanResult(payload.result);
    setResult(normalizedResult);
    setFolderUrl(normalizedResult.folderUrl);
  }

  function updateFolderUrl(value: string) {
    shouldPersistDraftRef.current = true;
    setFolderUrl(value);
  }

  function selectEmptyFields() {
    shouldPersistDraftRef.current = true;
    const emptyCandidateIds = applyableCandidates
      .filter((candidate) => !currentFieldValue(operation, candidate.field))
      .map((candidate) => candidate.id);

    setSelectedIds(emptyCandidateIds);
  }

  function toggleCandidate(candidateId: string, checked: boolean) {
    shouldPersistDraftRef.current = true;
    setSelectedIds((current) =>
      checked ? [...current, candidateId] : current.filter((selectedId) => selectedId !== candidateId)
    );
  }

  function updateEditedValue(candidateId: string, value: string) {
    shouldPersistDraftRef.current = true;
    setEditedValues((current) => ({
      ...current,
      [candidateId]: value
    }));
  }
}

function driveImportDraftKey(operationId: string): string {
  return `${DRIVE_IMPORT_DRAFT_PREFIX}${operationId}`;
}

function readDriveImportDraft(key: string, operationId: string): DriveImportDraft | null {
  try {
    const rawDraft = window.localStorage.getItem(key);
    if (!rawDraft) return null;

    const draft = JSON.parse(rawDraft) as Partial<DriveImportDraft>;
    if (
      draft.version !== DRIVE_IMPORT_DRAFT_VERSION ||
      draft.operationId !== operationId ||
      typeof draft.folderUrl !== "string" ||
      typeof draft.savedAt !== "string" ||
      !Array.isArray(draft.selectedIds) ||
      !isStringRecord(draft.editedValues)
    ) {
      window.localStorage.removeItem(key);
      return null;
    }

    const savedAtMs = new Date(draft.savedAt).getTime();
    if (!Number.isFinite(savedAtMs) || Date.now() - savedAtMs > DRIVE_IMPORT_DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }

    return {
      version: DRIVE_IMPORT_DRAFT_VERSION,
      operationId,
      folderUrl: draft.folderUrl,
      folderSearchResult: draft.folderSearchResult ?? null,
      result: draft.result ?? null,
      selectedIds: draft.selectedIds.filter((value): value is string => typeof value === "string"),
      editedValues: draft.editedValues,
      savedAt: draft.savedAt
    };
  } catch {
    return null;
  }
}

function writeDriveImportDraft(key: string, draft: DriveImportDraft) {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // 임시저장은 보조 기능이라 저장소 제한/차단 시 기존 흐름을 막지 않습니다.
  }
}

function removeDriveImportDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  return Object.values(value).every((entry) => typeof entry === "string");
}

function normalizeDriveImportScanResult(result: DriveImportScanResult): DriveImportScanResult {
  return {
    ...result,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      value: normalizeDriveCandidateValue(candidate)
    }))
  };
}

function normalizeDriveCandidateValue(candidate: DriveImportCandidate): string {
  if (candidate.field === "instructors" && candidate.value === "사내") {
    return "사내강사";
  }

  return candidate.value;
}

function isVisibleDriveCandidate(candidate: DriveImportCandidate): boolean {
  const normalizedValue = normalizeCandidateText(candidate.value);

  if (candidate.field === "instructors") {
    return (
      /^[가-힣]{2,5}$/.test(candidate.value.trim()) &&
      !BLOCKED_INSTRUCTOR_CANDIDATE_VALUES.has(normalizedValue) &&
      !normalizedValue.endsWith("필요") &&
      !normalizedValue.endsWith("후보") &&
      !normalizedValue.endsWith("섭외")
    );
  }

  if (candidate.field === "courseName") {
    return (
      normalizedValue.length >= 4 &&
      !BLOCKED_COURSE_CANDIDATE_VALUES.has(normalizedValue) &&
      !normalizedValue.endsWith("내용") &&
      !normalizedValue.endsWith("상세") &&
      !normalizedValue.endsWith("조건")
    );
  }

  return true;
}

function normalizeCandidateText(value: string): string {
  return value.toLowerCase().replace(/[\s_\-()[\]{}.,:/|~·]+/g, "").trim();
}

function candidateActionLabel(candidate: DriveImportCandidate, currentValue: string): string {
  if (candidate.action === "append") return currentValue ? "기존 값 뒤에 추가" : "값 입력";

  return currentValue ? "기존 값 덮어쓰기" : "값 입력";
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
