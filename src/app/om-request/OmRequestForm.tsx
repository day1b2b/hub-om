"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MultiDateCalendar } from "@/components/MultiDateCalendar";
import { NameCombobox } from "@/components/NameCombobox";
import { parseToolsValue, TOOL_GROUPS, TOOL_META_OPTIONS } from "@/lib/data/omRequest/omToolOptions";
import { calcSessionDuration, type OmRequestInput, type OmRequestSession, type TrainingType, type YN } from "@/lib/data/omRequest/omRequestTypes";
import { COURSE_CATEGORY_GROUPS, getCourseCategoryMajor, getCourseCategoryMinors } from "@/lib/data/omRequest/omCourseCategoryOptions";
import { parseSessionSheet } from "@/lib/data/omRequest/omSessionSheet";
import { deriveDateRangeFromEducationDates, parseEducationDatesText } from "@/lib/data/operationCalculations";
import { sessionDatesOf, summarizeSessionDates } from "@/lib/data/omRequest/omRequestSessionDates";

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

const TEAM_OPTIONS = ["1파트", "2파트", "3파트"];
const TRAINING_TYPE_OPTIONS: TrainingType[] = ["오프라인", "블렌디드", "비대면", "해커톤"];

function resolveTeamOption(memberTeam?: string): string | undefined {
  if (!memberTeam) return undefined;
  return TEAM_OPTIONS.find((option) => memberTeam.includes(option));
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

function emptySession(): OmRequestSession {
  return { date: "", dateEnd: "", timeStart: "", timeEnd: "", duration: "", location: "", educationDatesText: "" };
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

function useCloseOnOutsideClick(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);
  return ref;
}

function ToolMultiSelect({
  extraTools,
  selected,
  customTools,
  onToggle,
  onCustomChange
}: {
  extraTools: string[];
  selected: Set<string>;
  customTools: string;
  onToggle: (tool: string) => void;
  onCustomChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useCloseOnOutsideClick(open, () => setOpen(false));

  const customList = customTools.split(",").map((t) => t.trim()).filter(Boolean);
  const groups = [
    ...TOOL_GROUPS,
    ...(extraTools.length > 0 ? [{ category: "추가된 도구", tools: extraTools }] : []),
    { category: "기타", tools: TOOL_META_OPTIONS }
  ];

  const q = query.trim().toLowerCase();
  const filteredGroups = q
    ? groups.map((g) => ({ ...g, tools: g.tools.filter((t) => t.toLowerCase().includes(q)) })).filter((g) => g.tools.length > 0)
    : groups;
  const hasExactMatch = q !== "" && groups.some((g) => g.tools.some((t) => t.toLowerCase() === q));

  function removeCustom(tool: string) {
    onCustomChange(customList.filter((t) => t !== tool).join(", "));
  }

  function addCustom() {
    const value = query.trim();
    if (!value || customList.includes(value)) return;
    onCustomChange([...customList, value].join(", "));
    setQuery("");
  }

  return (
    <div className="om-tool-select" ref={containerRef}>
      <div className="om-tool-tags" onClick={() => setOpen(true)}>
        {Array.from(selected).map((tool) => (
          <span className="om-tool-tag" key={tool}>
            {tool}
            <button type="button" aria-label={`${tool} 제거`} onClick={(e) => { e.stopPropagation(); onToggle(tool); }}>×</button>
          </span>
        ))}
        {customList.map((tool) => (
          <span className="om-tool-tag om-tool-tag-custom" key={tool}>
            {tool}
            <button type="button" aria-label={`${tool} 제거`} onClick={(e) => { e.stopPropagation(); removeCustom(tool); }}>×</button>
          </span>
        ))}
        <input
          className="om-tool-search-input"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addCustom(); }
            if (e.key === "Backspace" && query === "") {
              if (customList.length > 0) removeCustom(customList[customList.length - 1]);
              else {
                const last = Array.from(selected).pop();
                if (last) onToggle(last);
              }
            }
          }}
          placeholder={selected.size === 0 && customList.length === 0 ? "Tool 검색 (예: ChatGPT, Python)" : "추가 검색..."}
          type="text"
          value={query}
        />
      </div>
      {open && (
        <div className="om-tool-dropdown">
          {filteredGroups.map((g) => (
            <div className="om-tool-dropdown-group" key={g.category}>
              <span className="om-tool-dropdown-group-title">{g.category}</span>
              {g.tools.map((tool) => (
                <button
                  className={`om-tool-dropdown-option${selected.has(tool) ? " selected" : ""}`}
                  key={tool}
                  onMouseDown={(e) => { e.preventDefault(); onToggle(tool); setQuery(""); }}
                  type="button"
                >
                  <span>{tool}</span>
                  {selected.has(tool) && <span className="om-tool-check">✓</span>}
                </button>
              ))}
            </div>
          ))}
          {filteredGroups.length === 0 && <p className="om-tool-dropdown-empty">일치하는 도구가 없습니다.</p>}
          {q !== "" && !hasExactMatch && !customList.includes(query.trim()) && (
            <button className="om-tool-dropdown-add" onMouseDown={(e) => { e.preventDefault(); addCustom(); }} type="button">
              + &ldquo;{query.trim()}&rdquo; 직접 추가
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CompanyCombobox({
  value,
  knownCompanies,
  onChange
}: {
  value: string;
  knownCompanies: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useCloseOnOutsideClick(open, () => setOpen(false));

  const q = value.trim().toLowerCase();
  const matches = q ? knownCompanies.filter((c) => c.toLowerCase().includes(q)) : knownCompanies;
  const isNewCompany = q !== "" && !knownCompanies.some((c) => c.toLowerCase() === q);

  return (
    <div className="om-company-combobox" ref={containerRef}>
      <input
        required
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="고객사명"
        type="text"
        value={value}
      />
      {open && matches.length > 0 && (
        <div className="om-company-dropdown">
          {matches.slice(0, 20).map((company) => (
            <button
              className="om-company-dropdown-option"
              key={company}
              onMouseDown={(e) => { e.preventDefault(); onChange(company); setOpen(false); }}
              type="button"
            >
              {company}
            </button>
          ))}
        </div>
      )}
      {isNewCompany && <p className="om-field-hint om-company-new-hint">이 표기로 접수된 적이 없어요. 오타가 아니라면 이대로 접수해주세요.</p>}
    </div>
  );
}

export function OmRequestForm({
  extraTools = [],
  ldName,
  defaultTeam,
  initialData,
  requestId,
  knownCompanies = [],
  knownInstructors = []
}: {
  extraTools?: string[];
  ldName: string;
  defaultTeam?: string;
  initialData?: OmRequestInput;
  requestId?: string;
  knownCompanies?: string[];
  knownInstructors?: string[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // 접수 완료 모달. 제출 버튼이 폼 하단이라 상단 안내를 놓치기 쉬워, 클릭 위치에 바로 뜨는 모달로 확인시킨다.
  const [submitted, setSubmitted] = useState(false);
  const [openDateEditorIndex, setOpenDateEditorIndex] = useState<number | null>(null);

  const [form, setForm] = useState<OmRequestInput>(() => {
    const base: OmRequestInput = initialData ?? {
      team: resolveTeamOption(defaultTeam) ?? "1파트",
      ld: ldName,
      company: "",
      trainingType: "오프라인",
      courseId: "",
      courseName: "",
      courseCategoryMajor: "",
      courseCategory: "",
      tools: "",
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
    };
    return { ...base, courseCategoryMajor: base.courseCategoryMajor || getCourseCategoryMajor(base.courseCategory) || "" };
  });

  const [{ custom: initialCustomTools, selected: initialSelectedTools }] = useState(() => parseToolsValue(initialData?.tools ?? "", extraTools));
  const [selectedTools, setSelectedTools] = useState(initialSelectedTools);
  const [customTools, setCustomTools] = useState(initialCustomTools);

  function setField<K extends keyof OmRequestInput>(key: K, value: OmRequestInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function syncToolsField(selected: Set<string>, custom: string) {
    const combined = [...selected, ...(custom.trim() ? [custom.trim()] : [])].join(", ");
    setField("tools", combined);
  }

  function toggleTool(tool: string) {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      const isMeta = TOOL_META_OPTIONS.includes(tool);
      if (next.has(tool)) {
        next.delete(tool);
      } else if (isMeta) {
        next.clear();
        next.add(tool);
      } else {
        TOOL_META_OPTIONS.forEach((meta) => next.delete(meta));
        next.add(tool);
      }
      syncToolsField(next, customTools);
      return next;
    });
  }

  function handleCustomToolsChange(value: string) {
    setCustomTools(value);
    syncToolsField(selectedTools, value);
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

  async function handleSessionSheetUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setSheetError(null);
    const buffer = await file.arrayBuffer();
    const { rows, fatalError } = parseSessionSheet(buffer);

    if (fatalError) {
      setSheetError(fatalError);
      return;
    }
    if (rows.length === 0) {
      setSheetError("시트에 입력된 회차가 없습니다.");
      return;
    }
    if (rows.length > 30) {
      setSheetError("회차는 최대 30개까지 입력할 수 있습니다.");
      return;
    }
    const rowErrors = rows.filter((row) => row.errors.length > 0);
    if (rowErrors.length > 0) {
      setSheetError(rowErrors.map((row) => `${row.rowNumber}행: ${row.errors.join(" ")}`).join(" / "));
      return;
    }

    setForm((prev) => ({ ...prev, totalSessions: rows.length, sessions: rows.map((row) => row.session) }));
  }

  function updateSession(idx: number, key: keyof OmRequestSession, value: string) {
    setForm((prev) => {
      const sessions = prev.sessions.map((s, i) => {
        if (i !== idx) return s;
        const updated = { ...s, [key]: value };
        if (key === "timeStart" || key === "timeEnd") {
          const start = key === "timeStart" ? value : s.timeStart;
          const end = key === "timeEnd" ? value : s.timeEnd;
          updated.duration = calcSessionDuration(start, end);
        }
        return updated;
      });
      return { ...prev, sessions };
    });
  }

  /** 달력에서 고른 날짜들로 date/dateEnd(최소/최대)와 educationDatesText를 한 번에 갱신한다. */
  function updateSessionDates(idx: number, dates: string[]) {
    const range = deriveDateRangeFromEducationDates(dates);
    setForm((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s, i) =>
        i === idx
          ? { ...s, date: range?.startDate ?? "", dateEnd: range?.endDate ?? "", educationDatesText: dates.join(", ") }
          : s
      )
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedTools.size === 0 && !customTools.trim()) {
      setError("사용 Tool을 1개 이상 선택하거나 입력해주세요.");
      return;
    }
    const instructorName = form.instructorName.trim();
    if (instructorName && !knownInstructors.some((name) => name.toLowerCase() === instructorName.toLowerCase())) {
      setError("등록된 강사 명단과 이름이 달라요. 강사DB 노션을 확인해주세요.");
      return;
    }
    const invalidEducationDatesRow = form.sessions.findIndex(
      (session) =>
        session.educationDatesText?.trim() && parseEducationDatesText(session.educationDatesText).errors.length > 0
    );
    if (invalidEducationDatesRow !== -1) {
      setError(`${invalidEducationDatesRow + 1}회차 실제교육일 형식을 확인해주세요 (예: 2026-09-03, 2026-09-04).`);
      return;
    }
    const missingDatesRow = form.sessions.findIndex((session) => !session.date);
    if (missingDatesRow !== -1) {
      setError(`${missingDatesRow + 1}회차 교육일을 최소 1일 선택해주세요.`);
      return;
    }
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
        // 접수 성공 → 하단에서 클릭해도 바로 보이도록 화면 중앙 모달로 확인시킨다.
        setSubmitted(true);
        setSubmitting(false);
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
            <span>LD<RequiredMark /></span>
            {requestId ? (
              <input
                required
                type="text"
                value={form.ld}
                onChange={(e) => setField("ld", e.target.value)}
              />
            ) : (
              <input disabled type="text" value={form.ld} title="LD는 로그인한 본인 기준으로 고정됩니다." />
            )}
          </label>

          <label>
            <span>기업명<RequiredMark /></span>
            <CompanyCombobox value={form.company} knownCompanies={knownCompanies} onChange={(v) => setField("company", v)} />
          </label>

          <label>
            <span>사업자등록번호</span>
            <input
              type="text"
              value={form.businessNumber ?? ""}
              placeholder="-없이 10자리"
              maxLength={10}
              onChange={(e) => setField("businessNumber", e.target.value.replace(/\D/g, "").slice(0, 10))}
            />
          </label>

          <label>
            <span>교육형태<RequiredMark /></span>
            <select value={form.trainingType} onChange={(e) => setField("trainingType", e.target.value as TrainingType)}>
              {TRAINING_TYPE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>

          <label>
            <span>과정 카테고리 대분류<RequiredMark /></span>
            <select
              required
              value={form.courseCategoryMajor ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, courseCategoryMajor: e.target.value, courseCategory: "" }))}
            >
              <option value="">선택</option>
              {COURSE_CATEGORY_GROUPS.map((group) => <option key={group.major}>{group.major}</option>)}
            </select>
          </label>

          <label>
            <span>과정 카테고리 소분류<RequiredMark /></span>
            <select
              required
              disabled={!form.courseCategoryMajor}
              value={form.courseCategory}
              onChange={(e) => setField("courseCategory", e.target.value)}
            >
              <option value="">{form.courseCategoryMajor ? "선택" : "대분류를 먼저 선택하세요"}</option>
              {getCourseCategoryMinors(form.courseCategoryMajor ?? "").map((minor) => <option key={minor}>{minor}</option>)}
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
            <NameCombobox
              options={knownInstructors}
              onChange={(value) => setField("instructorName", value)}
              placeholder="강사DB 노션에 등록된 이름 기입"
              unmatchedHint="등록된 강사 명단과 이름이 달라요. 강사DB 노션을 확인해주세요."
              value={form.instructorName}
            />
          </label>

          <label>
            <span>싱크업 링크<RequiredMark /></span>
            <input
              required
              type="text"
              value={form.syncupLink}
              placeholder="https://"
              onChange={(e) => setField("syncupLink", e.target.value)}
            />
          </label>

          <label>
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

      {/* 사용 Tool */}
      <div className="operation-form-section">
        <div className="section-title">
          <h2>사용 Tool<RequiredMark /></h2>
          <p className="om-field-hint">아직 tool이 정해지지 않았을 시 미확인을 검색해 선택바랍니다.</p>
        </div>
        <ToolMultiSelect
          extraTools={extraTools}
          selected={selectedTools}
          customTools={customTools}
          onToggle={toggleTool}
          onCustomChange={handleCustomToolsChange}
        />
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

        <div className="om-session-toolbar">
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
          <div className="om-session-toolbar-actions">
            <a className="secondary-action" download href="/api/om-request/session-template">샘플 시트 다운로드</a>
            <label className="secondary-action om-session-upload-label">
              엑셀로 일괄 입력
              <input
                accept=".xlsx"
                className="om-session-upload-input"
                onChange={handleSessionSheetUpload}
                type="file"
              />
            </label>
          </div>
        </div>
        {sheetError && <p className="om-request-error">{sheetError}</p>}

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
              <button
                className="session-dates-trigger"
                onClick={() => setOpenDateEditorIndex(idx)}
                type="button"
              >
                {summarizeSessionDates(session)}
              </button>
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
                value={session.duration ? `${session.duration}h` : ""}
                placeholder="자동"
                readOnly
              />
              <div className="location-input-wrapper">
                <input
                  required
                  type="text"
                  value={session.location}
                  placeholder="장소 입력 또는 검색 (미정이면 미정이라고 기입)"
                  onChange={(e) => updateSession(idx, "location", e.target.value)}
                />
                <AddressSearchButton onSelect={(addr) => updateSession(idx, "location", addr)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {openDateEditorIndex !== null && form.sessions[openDateEditorIndex] ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={() => setOpenDateEditorIndex(null)} />
          <section aria-labelledby="session-dates-title" className="drive-review-dialog session-dates-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="session-dates-title">{openDateEditorIndex + 1}회차 교육일</h2>
                <p>실제 교육이 있는 날짜만 달력에서 클릭하세요.</p>
              </div>
              <button aria-label="교육일 선택 닫기" onClick={() => setOpenDateEditorIndex(null)} type="button">
                닫기
              </button>
            </div>
            <div className="lecture-note-body">
              <MultiDateCalendar
                onChange={(dates) => updateSessionDates(openDateEditorIndex, dates)}
                value={sessionDatesOf(form.sessions[openDateEditorIndex])}
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

      {/* 요청사항 */}
      <div className="operation-form-section">
        <div className="section-title">
          <h2>요청사항<RequiredMark /></h2>
          <p className="om-field-hint">과정 관련하여 최대한 자세하게 작성바랍니다.</p>
        </div>
        <div className="operation-form-grid">
          <label className="full-row-field">
            <textarea
              required
              rows={5}
              value={form.notes}
              placeholder="예) 결과보고서 유무, 다과 유무, 이전 요청 사항 등"
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

    {submitted && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="요청 접수 완료"
        style={{ position: "fixed", inset: 0, background: "rgba(15,19,25,.5)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}
      >
        <div style={{ background: "#ffffff", color: "#1a1f2b", borderRadius: 16, padding: "30px 26px", maxWidth: 400, width: "100%", textAlign: "center", boxShadow: "0 12px 44px rgba(0,0,0,.28)" }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#2f9e44", color: "#fff", display: "grid", placeItems: "center", fontSize: 30, margin: "0 auto 16px" }} aria-hidden="true">✓</div>
          <h2 style={{ margin: "0 0 22px", fontSize: "1.25rem" }}>요청이 접수되었습니다</h2>
          <button
            className="primary-action"
            type="button"
            style={{ width: "100%" }}
            onClick={() => router.push("/om-request/manage")}
          >
            확인 (담당 관리로 이동)
          </button>
        </div>
      </div>
    )}
    </>
  );
}
