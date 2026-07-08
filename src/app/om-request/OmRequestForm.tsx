"use client";

import Script from "next/script";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OmRequestInput, OmRequestSession, TrainingType, YN } from "@/lib/data/omRequest/omRequestTypes";

declare global {
  interface Window {
    daum: {
      Postcode: new (options: { oncomplete: (data: { roadAddress: string; buildingName: string }) => void }) => { open: () => void };
    };
  }
}

function AddressSearchButton({ onSelect }: { onSelect: (address: string) => void }) {
  function handleClick() {
    if (!window.daum?.Postcode) return;
    new window.daum.Postcode({
      oncomplete(data) {
        const address = data.buildingName ? `${data.roadAddress} (${data.buildingName})` : data.roadAddress;
        onSelect(address);
      }
    }).open();
  }

  return (
    <button type="button" className="address-search-btn" onClick={handleClick} aria-label="주소 검색">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  );
}

const TEAM_OPTIONS = ["1팀", "2팀"];
const TRAINING_TYPE_OPTIONS: TrainingType[] = ["오프라인", "블랜디드", "비대면", "해커톤"];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

function emptySession(): OmRequestSession {
  return { date: "", timeStart: "", timeEnd: "", duration: "", location: "" };
}

function formatDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function DateInput({ value, required, onChange }: { value: string; required?: boolean; onChange: (v: string) => void }) {
  const pickerRef = useRef<HTMLInputElement>(null);
  return (
    <div className="date-input-wrapper">
      <input
        required={required}
        type="text"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        value={value}
        onChange={(e) => onChange(formatDateInput(e.target.value))}
      />
      <button
        type="button"
        className="date-picker-btn"
        onClick={() => pickerRef.current?.showPicker()}
        aria-label="달력에서 선택"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M1 7h14" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      <input
        ref={pickerRef}
        type="date"
        className="date-picker-hidden"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}


function RequiredMark() {
  return <em className="required-mark" aria-label="필수">*</em>;
}

function YNToggle({
  label,
  required,
  value,
  onChange
}: {
  label: string;
  required?: boolean;
  value: YN;
  onChange: (v: YN) => void;
}) {
  return (
    <label>
      <span>{label}{required && <RequiredMark />}</span>
      <div className="yn-toggle-row">
        <button className={`yn-btn${value === "Y" ? " selected" : ""}`} type="button" onClick={() => onChange("Y")}>Y</button>
        <button className={`yn-btn${value === "N" ? " selected" : ""}`} type="button" onClick={() => onChange("N")}>N</button>
      </div>
    </label>
  );
}

export function OmRequestForm({ ldName, initialData, requestId }: { ldName: string; initialData?: OmRequestInput; requestId?: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<OmRequestInput>(initialData ?? {
    team: "1팀",
    ld: ldName,
    company: "",
    trainingType: "오프라인",
    courseId: "",
    courseName: "",
    instructorName: "",
    driveLink: "",
    syncupLink: "",
    skillfloSetup: "N",
    skillmatchSetup: "N",
    onSiteOperation: "N",
    coachRequest: "N",
    totalSessions: 1,
    sessions: [emptySession()],
    notes: ""
  });

  function setField<K extends keyof OmRequestInput>(key: K, value: OmRequestInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleTotalSessionsChange(n: number) {
    const count = Math.max(1, Math.min(30, n));
    setForm((prev) => {
      const current = prev.sessions;
      if (count <= current.length) return { ...prev, totalSessions: count, sessions: current.slice(0, count) };
      const first = current[0];
      const added = Array.from({ length: count - current.length }, () => ({
        ...emptySession(),
        timeStart: first?.timeStart ?? "",
        timeEnd: first?.timeEnd ?? "",
        duration: first?.duration ?? "",
        location: first?.location ?? ""
      }));
      return { ...prev, totalSessions: count, sessions: [...current, ...added] };
    });
  }

  function updateSession(idx: number, key: keyof OmRequestSession, value: string) {
    setForm((prev) => {
      const sessions = prev.sessions.map((s, i) => (i === idx ? { ...s, [key]: value } : s));
      return { ...prev, sessions };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (requestId) {
        const res = await fetch(`/api/om-request/${requestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form)
        });
        if (!res.ok) throw new Error("저장에 실패했습니다.");
        router.push(`/om-request/manage/${requestId}`);
        router.refresh();
      } else {
        const res = await fetch("/api/om-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form)
        });
        if (!res.ok) throw new Error("저장에 실패했습니다.");
        const created = await res.json() as { id: string };
        router.push(`/om-request/complete?id=${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <>
    <Script src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js" strategy="lazyOnload" />
    <form className="operation-form om-request-form" onSubmit={handleSubmit}>

      {/* 기본 정보 */}
      <div className="operation-form-section">
        <div className="section-title"><h2>기본 정보</h2></div>
        <div className="operation-form-grid">

          <label>
            <span>구분<RequiredMark /></span>
            <select value={form.team} onChange={(e) => setField("team", e.target.value)}>
              {TEAM_OPTIONS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>

          <label>
            <span>LD<RequiredMark /></span>
            <input
              required
              type="text"
              value={form.ld}
              onChange={(e) => setField("ld", e.target.value)}
            />
          </label>

          <label>
            <span>기업명<RequiredMark /></span>
            <input
              required
              type="text"
              value={form.company}
              placeholder="고객사명"
              onChange={(e) => setField("company", e.target.value)}
            />
          </label>

          <label>
            <span>교육형태<RequiredMark /></span>
            <select value={form.trainingType} onChange={(e) => setField("trainingType", e.target.value as TrainingType)}>
              {TRAINING_TYPE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>

          <label>
            <span>코스 ID</span>
            <input
              type="text"
              value={form.courseId}
              onChange={(e) => setField("courseId", e.target.value)}
            />
          </label>

          <label>
            <span>과정명<RequiredMark /></span>
            <input
              required
              type="text"
              value={form.courseName}
              onChange={(e) => setField("courseName", e.target.value)}
            />
          </label>

          <label>
            <span>강사명</span>
            <input
              type="text"
              value={form.instructorName}
              onChange={(e) => setField("instructorName", e.target.value)}
            />
          </label>

          <label className="wide-field">
            <span>싱크업 링크<RequiredMark /></span>
            <input
              required
              type="text"
              value={form.syncupLink}
              placeholder="https://"
              onChange={(e) => setField("syncupLink", e.target.value)}
            />
          </label>

          <label className="wide-field">
            <span>드라이브 링크</span>
            <input
              type="text"
              value={form.driveLink}
              placeholder="https://"
              onChange={(e) => setField("driveLink", e.target.value)}
            />
          </label>

        </div>
      </div>

      {/* 세팅 및 운영 */}
      <div className="operation-form-section">
        <div className="section-title"><h2>세팅 및 운영</h2></div>
        <div className="operation-form-grid">
          <YNToggle required label="스킬플로 세팅" value={form.skillfloSetup} onChange={(v) => setField("skillfloSetup", v)} />
          <YNToggle label="스킬매치 세팅" value={form.skillmatchSetup} onChange={(v) => setField("skillmatchSetup", v)} />
          <YNToggle required label="현장 운영" value={form.onSiteOperation} onChange={(v) => setField("onSiteOperation", v)} />
          <YNToggle required label="실습 코치 요청" value={form.coachRequest} onChange={(v) => setField("coachRequest", v)} />
        </div>
      </div>

      {/* 교육 일정 */}
      <div className="operation-form-section">
        <div className="section-title"><h2>교육 일정</h2></div>
        <div className="operation-form-grid compact">
          <label className="om-session-count-field">
            <span>총 회차<RequiredMark /></span>
            <input
              min={1}
              max={30}
              required
              type="number"
              value={form.totalSessions}
              onChange={(e) => handleTotalSessionsChange(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="om-sessions-table">
          <div className="om-sessions-header">
            <span>회차</span>
            <span>교육일<em className="required-mark">*</em></span>
            <span>시작 시간<em className="required-mark">*</em></span>
            <span>종료 시간<em className="required-mark">*</em></span>
            <span>시수</span>
            <span>장소<em className="required-mark">*</em></span>
          </div>
          {form.sessions.map((session, idx) => (
            <div className="om-sessions-row" key={idx}>
              <span className="session-num">{idx + 1}</span>
              <DateInput
                required
                value={session.date}
                onChange={(v) => updateSession(idx, "date", v)}
              />
              <select
                required
                value={session.timeStart}
                onChange={(e) => updateSession(idx, "timeStart", e.target.value)}
              >
                <option value="">시작</option>
                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                required
                value={session.timeEnd}
                onChange={(e) => updateSession(idx, "timeEnd", e.target.value)}
              >
                <option value="">종료</option>
                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                className="duration-input"
                type="text"
                value={session.duration}
                placeholder=""
                onChange={(e) => updateSession(idx, "duration", e.target.value)}
              />
              <div className="location-input-wrapper">
                <input
                  required
                  type="text"
                  value={session.location}
                  placeholder="장소 입력 또는 검색"
                  onChange={(e) => updateSession(idx, "location", e.target.value)}
                />
                <AddressSearchButton onSelect={(addr) => updateSession(idx, "location", addr)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 요청사항 */}
      <div className="operation-form-section">
        <div className="section-title"><h2>요청사항<RequiredMark /></h2></div>
        <div className="operation-form-grid">
          <label className="full-row-field">
            <textarea
              required
              rows={5}
              value={form.notes}
              placeholder="예) 결과보고서 유무, 다과 유무, 이전 OM 배정 요청 등"
              onChange={(e) => setField("notes", e.target.value)}
            />
          </label>
        </div>
      </div>

      {error && <p className="om-request-error">{error}</p>}

      <div className="operation-form-actions">
        <button className="primary-action" disabled={submitting} type="submit">
          {submitting ? "저장 중..." : requestId ? "수정 저장" : "요청 제출"}
        </button>
      </div>
    </form>
    </>
  );
}
