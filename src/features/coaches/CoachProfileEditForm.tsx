"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CoachDetail } from "@/lib/data/coachTypes";

interface CoachProfileEditFormProps {
  coach: CoachDetail;
}

interface FormState {
  name: string;
  workType: string;
  statusNote: string;
  returnDate: string;
  availabilityDetail: string;
  dxTag: string;
  fields: string;
  curriculums: string;
}

function toFormState(coach: CoachDetail): FormState {
  return {
    name: coach.name,
    workType: coach.workType ?? "",
    statusNote: coach.statusNote ?? "",
    returnDate: coach.returnDate ?? "",
    availabilityDetail: coach.availabilityDetail ?? "",
    dxTag: coach.dxTag ?? "",
    fields: coach.fields.join(", "),
    curriculums: coach.curriculums.join(", ")
  };
}

export function CoachProfileEditForm({ coach }: CoachProfileEditFormProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => toFormState(coach));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setForm(toFormState(coach));
    setError(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setError(null);
    setIsEditing(false);
  }

  function updateField(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("이름은 비워둘 수 없습니다.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const response = await fetch(`/api/coaches/${coach.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        workType: form.workType,
        statusNote: form.statusNote,
        returnDate: form.returnDate,
        availabilityDetail: form.availabilityDetail,
        dxTag: form.dxTag,
        fields: splitCsv(form.fields),
        curriculums: splitCsv(form.curriculums)
      })
    });

    setIsSaving(false);

    if (!response.ok) {
      setError("저장하지 못했습니다. 잠시 후 다시 시도하세요.");
      return;
    }

    setIsEditing(false);
    router.refresh();
  }

  if (!isEditing) {
    return (
      <button className="coach-profile-edit-toggle" onClick={startEdit} type="button">
        프로필 수정
      </button>
    );
  }

  return (
    <div className="coach-profile-edit-form">
      <label>
        <span>이름</span>
        <input onChange={(event) => updateField("name", event.target.value)} type="text" value={form.name} />
      </label>
      <label>
        <span>근무유형</span>
        <input onChange={(event) => updateField("workType", event.target.value)} type="text" value={form.workType} />
      </label>
      <label>
        <span>상태 메모</span>
        <input onChange={(event) => updateField("statusNote", event.target.value)} type="text" value={form.statusNote} />
      </label>
      <label>
        <span>복귀 예정일</span>
        <input onChange={(event) => updateField("returnDate", event.target.value)} type="date" value={form.returnDate} />
      </label>
      <label>
        <span>DX 태그</span>
        <input onChange={(event) => updateField("dxTag", event.target.value)} type="text" value={form.dxTag} />
      </label>
      <label className="coach-profile-edit-wide">
        <span>가능 분야 (쉼표로 구분)</span>
        <input onChange={(event) => updateField("fields", event.target.value)} type="text" value={form.fields} />
      </label>
      <label className="coach-profile-edit-wide">
        <span>가능 커리큘럼 (쉼표로 구분)</span>
        <input onChange={(event) => updateField("curriculums", event.target.value)} type="text" value={form.curriculums} />
      </label>
      <label className="coach-profile-edit-wide">
        <span>근무 가능 세부 내용</span>
        <textarea
          onChange={(event) => updateField("availabilityDetail", event.target.value)}
          rows={3}
          value={form.availabilityDetail}
        />
      </label>

      {error ? <p className="coach-profile-edit-error">{error}</p> : null}

      <div className="coach-profile-edit-actions">
        <button disabled={isSaving} onClick={handleSave} type="button">
          {isSaving ? "저장 중…" : "저장"}
        </button>
        <button disabled={isSaving} onClick={cancelEdit} type="button">취소</button>
      </div>
    </div>
  );
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
