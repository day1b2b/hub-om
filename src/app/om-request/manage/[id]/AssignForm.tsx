"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { OmRecommendationTier } from "@/lib/data/omAvailability/recommendOms";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

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
  const [error, setError] = useState<string | null>(null);

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

  async function handleSave() {
    if (!om.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/om-request/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, assignedOm: om.trim() })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "저장 실패");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!confirm("지정을 취소하시겠습니까?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/om-request/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, assignedOm: null })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "취소 실패");
      }
      setOm("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "취소에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="assign-form">
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
          disabled={saving || !om.trim()}
          onClick={handleSave}
        >
          저장
        </button>
        {isDone && (
          <button className="assign-cancel-btn" disabled={saving} onClick={handleCancel}>
            삭제
          </button>
        )}
      </div>
      {error && <p className="om-request-error">{error}</p>}
    </div>
  );
}
