"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callEggApi } from "@/features/eggs/eggApi";
import { SUPPLY_CATEGORY_LABEL } from "@/lib/data/supplies/supplyTypes";
import type { SupplyCategory, SupplyItemSummary } from "@/lib/data/supplies/supplyTypes";

interface SupplyItemPanelProps {
  category: SupplyCategory;
  items: SupplyItemSummary[];
}

interface ItemFormState {
  sortOrder: string;
  label: string;
  components: string;
  storageLocation: string;
  note: string;
}

function emptyForm(nextOrder: number, storageLocation: string): ItemFormState {
  return { sortOrder: String(nextOrder), label: "", components: "", storageLocation, note: "" };
}

function toForm(item: SupplyItemSummary): ItemFormState {
  return {
    sortOrder: String(item.sortOrder),
    label: item.label,
    components: item.components ?? "",
    storageLocation: item.storageLocation,
    note: item.note ?? ""
  };
}

/** 물품 관리 (관리자 전용). 에그 기기 관리와 같은 방식으로 화면에서 등록·수정한다. */
export function SupplyItemPanel({ category, items }: SupplyItemPanelProps) {
  const router = useRouter();
  const categoryLabel = SUPPLY_CATEGORY_LABEL[category];
  const nextOrder = items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;
  const defaultLocation = items[0]?.storageLocation ?? "";

  const [open, setOpen] = useState(items.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormState>(emptyForm(nextOrder, defaultLocation));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function update<K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm(nextOrder, defaultLocation));
    setError(null);
    setMessage(null);
  }

  function startEdit(item: SupplyItemSummary) {
    setEditingId(item.id);
    setForm(toForm(item));
    setError(null);
    setMessage(null);
  }

  async function submit() {
    setError(null);
    setMessage(null);
    if (!form.label.trim() || !form.storageLocation.trim()) {
      setError("물품 이름과 보관 위치를 입력해주세요.");
      return;
    }
    setPending(true);

    const body = {
      category,
      sortOrder: Number(form.sortOrder),
      label: form.label.trim(),
      components: form.components.trim(),
      storageLocation: form.storageLocation.trim(),
      note: form.note.trim()
    };

    const result = await callEggApi(
      editingId ? `/api/supplies/items/${editingId}` : "/api/supplies/items",
      editingId ? "PATCH" : "POST",
      body
    );
    setPending(false);

    if (!result.ok) {
      setError(result.error ?? "저장에 실패했습니다.");
      return;
    }

    setMessage(editingId ? "물품 정보를 수정했습니다." : "물품을 등록했습니다.");
    setEditingId(null);
    setForm(emptyForm(editingId ? nextOrder : Number(form.sortOrder) + 1, form.storageLocation.trim()));
    router.refresh();
  }

  return (
    <section className="dashboard-panel egg-admin">
      <div className="section-title">
        <h2>🔒 {categoryLabel} 물품 관리</h2>
        <div className="section-title-actions">
          <span>관리자만 보입니다.</span>
          <button type="button" className="secondary-action" onClick={() => setOpen((value) => !value)}>
            {open ? "접기" : `펼치기 (${items.length}개)`}
          </button>
        </div>
      </div>

      {open ? (
        <div className="egg-detail-body">
          {message ? <p className="egg-feedback egg-feedback-ok">{message}</p> : null}
          {error ? <p className="egg-feedback egg-feedback-error">{error}</p> : null}

          {items.length > 0 ? (
            <div className="table-wrap">
              <table className="egg-table">
                <thead>
                  <tr>
                    <th>순서</th>
                    <th>이름</th>
                    <th>구성품</th>
                    <th>보관 위치</th>
                    <th>안내 문구</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={item.id === editingId ? "egg-row-editing" : ""}>
                      <td>{item.sortOrder}</td>
                      <td>
                        <strong>{item.label}</strong>
                      </td>
                      <td>{item.components || "-"}</td>
                      <td>{item.storageLocation}</td>
                      <td>{item.note || "-"}</td>
                      <td>
                        <button type="button" className="secondary-action" onClick={() => startEdit(item)}>
                          수정
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="egg-form">
            <h3>{editingId ? "물품 정보 수정" : "새 물품 등록"}</h3>
            <div className="egg-form-grid">
              <label>
                <span>
                  정렬 순서 <span className="required-mark">*</span>
                </span>
                <input type="number" min={0} value={form.sortOrder} onChange={(event) => update("sortOrder", event.target.value)} />
              </label>
              <label>
                <span>
                  이름 <span className="required-mark">*</span>
                </span>
                <input
                  type="text"
                  value={form.label}
                  onChange={(event) => update("label", event.target.value)}
                  placeholder="예: 무선 마이크 세트"
                />
              </label>
              <label>
                <span>구성품</span>
                <input
                  type="text"
                  value={form.components}
                  onChange={(event) => update("components", event.target.value)}
                  placeholder="예: 무선 마이크 + 앰프"
                />
              </label>
              <label>
                <span>
                  보관 위치 <span className="required-mark">*</span>
                </span>
                <input
                  type="text"
                  value={form.storageLocation}
                  onChange={(event) => update("storageLocation", event.target.value)}
                />
              </label>
            </div>
            <label className="egg-form-full">
              <span>안내 문구 (한 줄, 카드에 표시)</span>
              <input
                type="text"
                value={form.note}
                onChange={(event) => update("note", event.target.value)}
                placeholder="예: 마이크와 앰프는 항상 같이 빌립니다."
              />
            </label>
            <div className="egg-actions">
              {editingId ? (
                <button type="button" className="assign-cancel-btn" disabled={pending} onClick={startCreate}>
                  수정 취소
                </button>
              ) : null}
              <button type="button" className="assign-save-btn" disabled={pending} onClick={submit}>
                {pending ? "저장 중..." : editingId ? "수정 저장" : "등록"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
