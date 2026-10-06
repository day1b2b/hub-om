"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OmRecommendationTier } from "@/lib/data/omAvailability/recommendOms";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";
import styles from "./AssignForm.module.css";

interface AssignmentPreview {
  token: string;
  count: number;
  operations: Array<{ operationId: string; roundNo: string | null; omName: string | null; omUserId: string | null }>;
  assignedOm: string | null;
  nextOm: string | null;
}

function normalizeOmName(value: string): string {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function OmRecommendations({ tiers, onPick }: { tiers: OmRecommendationTier[]; onPick: (name: string) => void }) {
  if (tiers.length === 0) return null;

  return (
    <div className="om-recommend-list">
      {tiers.map((tier) => (
        <div className="om-recommend-tier" key={tier.rank}>
          <span className="om-recommend-tier-label">{tier.rank}순위 · {tier.label}</span>
          <div className="om-recommend-chip-row">
            {tier.oms.map((name) => (
              <button className="om-recommend-chip" key={name} onClick={() => onPick(name)} type="button">
                {name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AssignForm({
  canAssign = true,
  managerName = null,
  omRoster = [],
  recommendations = [],
  request
}: {
  canAssign?: boolean;
  managerName?: string | null;
  omRoster?: string[];
  recommendations?: OmRecommendationTier[];
  request: OmRequest;
}) {
  const router = useRouter();
  const [om, setOm] = useState(request.assignedOm ?? "");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<(AssignmentPreview & { requestedOm: string | null }) | null>(null);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (preview && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    if (!preview && dialogRef.current?.open) dialogRef.current.close();
  }, [preview]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // 요청/담당자/권한 맥락이 바뀌면 이전 확인 token을 폐기한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(null);
  }, [request.id, request.team, request.assignedOm, request.status, canAssign, managerName]);


  const isDone = request.status === "배정완료";
  const knownNames = useMemo(() => new Set(omRoster.map(normalizeOmName)), [omRoster]);
  const isUnknownOm = om.trim().length > 0 && !knownNames.has(normalizeOmName(om));

  if (!canAssign) {
    return (
      <div className="assign-form">
        <div className="om-confirm-field">{request.assignedOm || "미지정"}</div>
        <p className="om-assign-warning">
          {managerName ? `${managerName}님만 이 파트의 OM을 지정할 수 있어요.` : "이 파트의 담당 관리자만 지정할 수 있어요."}
        </p>
      </div>
    );
  }

  async function loadPreview(assignedOm: string | null) {
    if (busyRef.current || preview) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/om-request/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, assignedOm })
      });
      const body = await res.json().catch(() => null) as { error?: string; preview?: AssignmentPreview } | null;
      if (!res.ok || !body?.preview?.token) throw new Error(body?.error ?? "영향받는 회차를 확인하지 못했습니다. 다시 시도해주세요.");
      setPreview({ ...body.preview, requestedOm: assignedOm });
    } catch (err) {
      setError(err instanceof Error ? err.message : "영향받는 회차를 확인하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  function handleSave() {
    if (om.trim()) return loadPreview(om.trim());
  }

  function handleCancel() {
    return loadPreview(null);
  }

  function dismissPreview() {
    if (busyRef.current) return;
    setPreview(null);
    setError(null);
  }

  async function confirmAssignment() {
    if (!preview || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/om-request/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, assignedOm: preview.requestedOm, confirmationToken: preview.token })
      });
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (res.status === 409) {
        setPreview(null);
        throw new Error(`${body?.error ?? "배정 정보가 변경되었거나 확인이 만료되었습니다."} 저장 또는 배정 취소를 다시 눌러 현재 회차와 담당자를 확인해주세요.`);
      }
      if (!res.ok) throw new Error(body?.error ?? "배정을 저장하지 못했습니다. 다시 시도해주세요.");
      setOm(preview.nextOm ?? "");
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "배정을 저장하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="assign-form">
      <fieldset disabled={saving || preview !== null} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <OmRecommendations tiers={recommendations} onPick={setOm} />
      <input
        type="text"
        placeholder="OM 이름 입력"
        value={om}
        onChange={(e) => setOm(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        className="assign-form-input"
        list="om-roster-options"
      />
      <datalist id="om-roster-options">
        {omRoster.map((name) => <option key={name} value={name} />)}
      </datalist>
      {isUnknownOm && (
        <p className="om-assign-warning">등록된 OM 명단과 이름이 달라요. 캘린더에 정확히 반영되도록 명단과 동일한 이름으로 입력해 주세요.</p>
      )}
      <div className="assign-form-row">
        <button
          className="assign-save-btn"
          disabled={saving || preview !== null || !om.trim()}
          onClick={handleSave}
        >
          {saving && !preview ? "영향 확인 중" : "저장"}
        </button>
        {isDone && (
          <button className="assign-cancel-btn" disabled={saving || preview !== null} onClick={handleCancel}>
            배정 취소
          </button>
        )}
      </div>
      </fieldset>
      {!preview && error && <p className="om-request-error" role="alert">{error}</p>}
      <dialog ref={dialogRef} aria-labelledby="assignment-confirm-title" className={styles.dialog} onCancel={(event) => { event.preventDefault(); dismissPreview(); }}>
        {preview && <>
          <h2 id="assignment-confirm-title">{preview.requestedOm === null ? "배정 취소 확인" : "OM 배정 확인"}</h2>
          <p>이 요청 접수 시 생성된 연결 회차 {preview.count}개의 담당자를 {preview.nextOm === null ? "모두 비웁니다." : `${preview.nextOm}(으)로 변경합니다.`}</p>
          <p>현재 수동으로 지정된 담당자도 함께 변경됩니다. 같은 과정에 나중에 추가한 회차는 포함되지 않습니다.</p>
          {preview.operations.length > 0 ? (
            <ul>
              {preview.operations.map((operation) => <li key={operation.operationId}>
                {operation.roundNo ?? "번호 없는"}회차 · 현재 담당: {operation.omName || (operation.omUserId ? "계정 지정 담당자(이름 확인 불가)" : "미지정")}
              </li>)}
            </ul>
          ) : <p>연결된 회차가 없어 요청의 배정 정보만 변경합니다.</p>}
          {error && <p className="om-request-error" role="alert">{error}</p>}
          <div className="assign-form-row">
            <button type="button" className="assign-cancel-btn" disabled={saving} onClick={dismissPreview}>돌아가기</button>
            <button type="button" className="assign-save-btn" disabled={saving} onClick={confirmAssignment}>
              {saving ? "저장 중" : preview.requestedOm === null ? "확인 후 배정 취소" : "확인 후 배정"}
            </button>
          </div>
        </>}
      </dialog>
    </div>
  );
}
