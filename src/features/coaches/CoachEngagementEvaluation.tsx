"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  COACH_AUDIENCES,
  COACH_ENGAGEMENT_ROLES,
  COACH_EVALUATION_DEFAULT_SCORE,
  COACH_FACT_KINDS,
  COACH_PRACTICE_DIFFICULTIES,
  COACH_REHIRE_INTENTS,
  evidenceRequired,
  scoreItemsForRole,
  storedEvaluationAverage,
  type CoachAudienceValue,
  type CoachEngagementRoleValue,
  type CoachEvaluationScores,
  type CoachFactKindValue,
  type CoachPracticeDifficultyValue,
  type CoachRehireIntentValue
} from "@/lib/coaches/coachEvaluationRules";

// =============================================================================
// 근무 이력 탭의 OM 평가·사실 기록. 원문은 OM·LD·정책 담당자에게만 보인다(서버가 canView로 알려 줌).
// 쓰기는 그 과정의 담당 매니저·정책 담당자만(서버가 writableEngagementIds로 알려 줌).
// =============================================================================

interface Evaluation {
  id: string;
  engagementId: string | null;
  scores: CoachEvaluationScores;
  rehire: CoachRehireIntentValue;
  rehireReason: string | null;
  evidence: string | null;
  evaluatorName: string | null;
  evaluatorEmail: string;
  updatedAt: string;
  canEdit: boolean;
}

interface Detail {
  engagementId: string;
  role: CoachEngagementRoleValue;
  practiceDifficulty: CoachPracticeDifficultyValue | null;
  audience: CoachAudienceValue | null;
  isNewClient: boolean | null;
}

interface Fact {
  id: string;
  engagementId: string | null;
  kind: CoachFactKindValue;
  occurredOn: string;
  description: string;
  recordedByName: string | null;
  recordedByEmail: string;
  canDelete: boolean;
}

interface ListResponse {
  ok: boolean;
  canView?: boolean;
  today?: string;
  evaluations?: Evaluation[];
  details?: Detail[];
  facts?: Fact[];
  /** 이 사람이 평가를 쓸 수 있는 투입(담당 매니저·정책 담당자). */
  writableEngagementIds?: string[];
  error?: string;
}

interface EvaluationState {
  coachId: string;
  status: "loading" | "ready" | "error";
  canView: boolean;
  today: string;
  byEngagement: Map<string, Evaluation>;
  details: Map<string, Detail>;
  facts: Map<string, Fact[]>;
  writable: Set<string>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  reload: () => Promise<void>;
}

const EvaluationContext = createContext<EvaluationState | null>(null);

async function fetchEvaluations(coachId: string): Promise<ListResponse | null> {
  const response = await fetch(`/api/coaches/${coachId}/evaluations`, { cache: "no-store" }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as ListResponse | null;
  return response?.ok && body?.ok ? body : null;
}

export function CoachEvaluationProvider({ coachId, children }: { coachId: string; children: ReactNode }) {
  const [status, setStatus] = useState<EvaluationState["status"]>("loading");
  const [payload, setPayload] = useState<ListResponse>({ ok: false });
  const [openId, setOpenId] = useState<string | null>(null);

  const apply = useCallback((body: ListResponse | null) => {
    if (body) {
      setPayload(body);
      setStatus("ready");
    } else {
      setStatus("error");
    }
  }, []);

  const reload = useCallback(async () => apply(await fetchEvaluations(coachId)), [apply, coachId]);

  useEffect(() => {
    let alive = true;
    fetchEvaluations(coachId).then((body) => {
      if (alive) apply(body);
    });
    return () => {
      alive = false;
    };
  }, [apply, coachId]);

  const value = useMemo<EvaluationState>(() => ({
    coachId,
    status,
    canView: payload.canView === true,
    today: payload.today ?? "",
    byEngagement: new Map((payload.evaluations ?? []).filter((item) => item.engagementId).map((item) => [item.engagementId as string, item])),
    details: new Map((payload.details ?? []).map((item) => [item.engagementId, item])),
    facts: groupFacts(payload.facts ?? []),
    writable: new Set(payload.writableEngagementIds ?? []),
    openId,
    setOpenId,
    reload
  }), [coachId, status, payload, openId, reload]);

  return (
    <EvaluationContext.Provider value={value}>
      {status === "error" ? <p className="coach-evaluation-notice">평가를 불러오지 못했어요. 새로고침해 주세요.</p> : null}
      {children}
    </EvaluationContext.Provider>
  );
}

function groupFacts(facts: Fact[]): Map<string, Fact[]> {
  const grouped = new Map<string, Fact[]>();
  for (const fact of facts) {
    if (!fact.engagementId) continue;
    grouped.set(fact.engagementId, [...(grouped.get(fact.engagementId) ?? []), fact]);
  }
  return grouped;
}

function useEvaluations() {
  const value = useContext(EvaluationContext);
  if (!value) throw new Error("CoachEvaluationProvider is required");
  return value;
}

export interface EvaluableEngagement {
  id: string;
  startDate: string;
  endDate: string;
  cancelled: boolean;
}

/** 평가는 끝난 투입, 사실 기록은 시작한 투입에 쓴다. 취소된 투입은 둘 다 안 쓴다. */
function engagementState(engagement: EvaluableEngagement, today: string, writable: Set<string>) {
  const canWrite = writable.has(engagement.id) && !engagement.cancelled && !!today;
  return {
    canEvaluate: canWrite && engagement.endDate <= today,
    canRecordFact: canWrite && engagement.startDate <= today
  };
}

/** 행 오른쪽 버튼. 평가가 있으면 평균, 없으면 담당 매니저에게 [평가하기]. 사실 기록이 있으면 건수. */
export function EngagementEvaluationButton({ engagement }: { engagement: EvaluableEngagement }) {
  const { status, canView, today, byEngagement, facts, writable, openId, setOpenId } = useEvaluations();
  if (status !== "ready" || !canView) return null;
  const evaluation = byEngagement.get(engagement.id);
  const factCount = facts.get(engagement.id)?.length ?? 0;
  const { canEvaluate, canRecordFact } = engagementState(engagement, today, writable);
  const open = openId === engagement.id;
  const toggle = () => setOpenId(open ? null : engagement.id);
  const average = evaluation ? storedEvaluationAverage(evaluation.scores) : null;

  const chips: ReactNode[] = [];
  if (evaluation) chips.push(<button aria-expanded={open} className="coach-evaluation-chip done" key="evaluation" onClick={toggle} type="button">평가 {average !== null ? average.toFixed(1) : "-"}</button>);
  else if (canEvaluate) chips.push(<button aria-expanded={open} className="coach-evaluation-chip" key="evaluation" onClick={toggle} type="button">평가하기</button>);
  if (factCount > 0) chips.push(<button aria-expanded={open} className="coach-evaluation-chip warn" key="fact" onClick={toggle} type="button">기록 {factCount}</button>);
  else if (canRecordFact && !canEvaluate && !evaluation) chips.push(<button aria-expanded={open} className="coach-evaluation-chip" key="fact" onClick={toggle} type="button">기록</button>);
  return chips.length > 0 ? <span className="coach-evaluation-chips">{chips}</span> : null;
}

/** 행 아래에 펼쳐지는 평가 보기·입력과 사실 기록. */
export function EngagementEvaluationPanel({ engagement }: { engagement: EvaluableEngagement }) {
  const { openId, byEngagement, details, facts, today, writable } = useEvaluations();
  const [editing, setEditing] = useState(false);
  if (openId !== engagement.id) return null;
  const evaluation = byEngagement.get(engagement.id);
  const detail = details.get(engagement.id) ?? null;
  const { canEvaluate, canRecordFact } = engagementState(engagement, today, writable);

  return (
    <div className="coach-evaluation-stack">
      {evaluation && !editing ? (
        <EvaluationView detail={detail} evaluation={evaluation} onEdit={() => setEditing(true)} />
      ) : evaluation || canEvaluate ? (
        <EvaluationForm detail={detail} engagementId={engagement.id} evaluation={evaluation ?? null} onDone={() => setEditing(false)} />
      ) : null}
      <FactSection canAdd={canRecordFact} engagement={engagement} facts={facts.get(engagement.id) ?? []} today={today} />
    </div>
  );
}

function FactSection({ engagement, facts, canAdd, today }: { engagement: EvaluableEngagement; facts: Fact[]; canAdd: boolean; today: string }) {
  const { coachId, reload } = useEvaluations();
  const lastDay = engagement.endDate < today ? engagement.endDate : today;
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<CoachFactKindValue | "">("");
  const [occurredOn, setOccurredOn] = useState(lastDay);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (facts.length === 0 && !canAdd) return null;

  async function request(url: string, init: RequestInit) {
    setSaving(true);
    setError(null);
    const response = await fetch(url, init).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setSaving(false);
    if (!response?.ok || !body?.ok) {
      setError(body?.error ?? "저장하지 못했어요. 다시 시도해 주세요.");
      return false;
    }
    await reload();
    return true;
  }

  async function add() {
    const done = await request(`/api/coaches/${coachId}/facts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId: engagement.id, kind, occurredOn, description })
    });
    if (done) {
      setAdding(false);
      setKind("");
      setDescription("");
    }
  }

  async function remove(fact: Fact) {
    if (!window.confirm("이 사실 기록을 지울까요?")) return;
    await request(`/api/coaches/${coachId}/facts/${fact.id}`, { method: "DELETE" });
  }

  return (
    <section className="coach-evaluation-panel coach-fact-panel">
      <header className="coach-evaluation-footer">
        <strong>사실 기록</strong>
        {canAdd && !adding ? <button className="coach-evaluation-button" onClick={() => setAdding(true)} type="button">기록 추가</button> : null}
      </header>
      {facts.length > 0 ? (
        <ul className="coach-fact-list">
          {facts.map((fact) => (
            <li key={fact.id}>
              <span className="coach-fact-kind">{labelOf(COACH_FACT_KINDS, fact.kind)}</span>
              <time>{fact.occurredOn}</time>
              <p>{fact.description}</p>
              <small>{fact.recordedByName ?? fact.recordedByEmail}</small>
              {fact.canDelete ? <button className="coach-evaluation-button danger" disabled={saving} onClick={() => void remove(fact)} type="button">지우기</button> : null}
            </li>
          ))}
        </ul>
      ) : !adding ? (
        <p className="coach-evaluation-hint">지각·무단 불참·공식 불만 같은 일이 있었을 때 바로 남겨 주세요. 점수와 따로 관리해요.</p>
      ) : null}
      {adding ? (
        <div className="coach-fact-form">
          <div className="coach-evaluation-row">
            <label>
              종류
              <select onChange={(event) => setKind(event.target.value as CoachFactKindValue | "")} value={kind}>
                <option value="">골라 주세요</option>
                {COACH_FACT_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              발생일
              <input max={lastDay} min={engagement.startDate} onChange={(event) => setOccurredOn(event.target.value)} type="date" value={occurredOn} />
            </label>
          </div>
          <label className="coach-evaluation-text">
            상황 <b>(필수)</b>
            <textarea maxLength={2000} onChange={(event) => setDescription(event.target.value)} placeholder="시간·장소·무슨 일이 있었는지 사실만 적어 주세요." rows={3} value={description} />
          </label>
          <footer className="coach-evaluation-footer">
            <small>사실 기록은 OM·LD만 볼 수 있어요.</small>
            <span className="coach-evaluation-actions">
              <button className="coach-evaluation-button" disabled={saving} onClick={() => setAdding(false)} type="button">취소</button>
              <button className="coach-evaluation-button primary" disabled={saving} onClick={() => void add()} type="button">{saving ? "저장 중…" : "저장"}</button>
            </span>
          </footer>
        </div>
      ) : null}
      {error ? <p className="coach-evaluation-error" role="alert">{error}</p> : null}
    </section>
  );
}

function labelOf<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T | null): string {
  return options.find((option) => option.value === value)?.label ?? "-";
}

function EvaluationView({ evaluation, detail, onEdit }: { evaluation: Evaluation; detail: Detail | null; onEdit: () => void }) {
  const { coachId, reload, setOpenId } = useEvaluations();
  const [error, setError] = useState<string | null>(null);
  const role = detail?.role ?? null;
  const items = role ? scoreItemsForRole(role) : [];

  async function remove() {
    if (!window.confirm("이 평가를 지울까요? 지운 평가는 평균에서 빠져요.")) return;
    const response = await fetch(`/api/coaches/${coachId}/evaluations/${evaluation.id}`, { method: "DELETE" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response?.ok || !body?.ok) {
      setError(body?.error ?? "지우지 못했어요. 다시 시도해 주세요.");
      return;
    }
    setOpenId(null);
    await reload();
  }

  return (
    <section className="coach-evaluation-panel">
      <dl className="coach-evaluation-summary">
        <div><dt>역할</dt><dd>{labelOf(COACH_ENGAGEMENT_ROLES, role)}</dd></div>
        <div><dt>실습 난이도</dt><dd>{detail?.practiceDifficulty ?? "-"}</dd></div>
        <div><dt>대상</dt><dd>{labelOf(COACH_AUDIENCES, detail?.audience ?? null)}{detail?.isNewClient ? " · 신규 고객사" : ""}</dd></div>
        {items.map((item) => (
          <div key={item.key}><dt>{item.label}</dt><dd>{evaluation.scores[item.key] ?? "-"}</dd></div>
        ))}
        <div><dt>재투입 의향</dt><dd>{labelOf(COACH_REHIRE_INTENTS, evaluation.rehire)}{evaluation.rehireReason ? ` · ${evaluation.rehireReason}` : ""}</dd></div>
      </dl>
      {evaluation.evidence ? <p className="coach-evaluation-evidence">{evaluation.evidence}</p> : null}
      <footer className="coach-evaluation-footer">
        <small>{evaluation.evaluatorName ?? evaluation.evaluatorEmail} · {evaluation.updatedAt.slice(0, 10)}</small>
        {evaluation.canEdit ? (
          <span className="coach-evaluation-actions">
            <button className="coach-evaluation-button" onClick={onEdit} type="button">고치기</button>
            <button className="coach-evaluation-button danger" onClick={() => void remove()} type="button">지우기</button>
          </span>
        ) : null}
      </footer>
      {error ? <p className="coach-evaluation-error" role="alert">{error}</p> : null}
    </section>
  );
}

function initialScores(evaluation: Evaluation | null): CoachEvaluationScores {
  const value = COACH_EVALUATION_DEFAULT_SCORE;
  return evaluation?.scores
    ? { ...evaluation.scores }
    : { practiceSupport: value, fieldOperation: value, communication: value, leading: value, punctuality: value };
}

function EvaluationForm({ engagementId, evaluation, detail, onDone }: { engagementId: string; evaluation: Evaluation | null; detail: Detail | null; onDone: () => void }) {
  const { coachId, reload, setOpenId } = useEvaluations();
  const [role, setRole] = useState<CoachEngagementRoleValue | null>(detail?.role ?? null);
  const [practiceDifficulty, setPracticeDifficulty] = useState<CoachPracticeDifficultyValue | "">(detail?.practiceDifficulty ?? "");
  const [audience, setAudience] = useState<CoachAudienceValue | "">(detail?.audience ?? "");
  const [isNewClient, setIsNewClient] = useState(detail?.isNewClient === true);
  const [scores, setScores] = useState<CoachEvaluationScores>(() => initialScores(evaluation));
  const [evidence, setEvidence] = useState(evaluation?.evidence ?? "");
  const [rehire, setRehire] = useState<CoachRehireIntentValue | null>(evaluation?.rehire ?? null);
  const [rehireReason, setRehireReason] = useState(evaluation?.rehireReason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = role ? scoreItemsForRole(role) : [];
  const needsEvidence = role ? evidenceRequired(role, scores) : false;

  async function submit() {
    setSaving(true);
    setError(null);
    const body = {
      engagementId,
      role,
      practiceDifficulty: practiceDifficulty || null,
      audience: audience || null,
      isNewClient,
      scores,
      evidence,
      rehire,
      rehireReason
    };
    const url = evaluation ? `/api/coaches/${coachId}/evaluations/${evaluation.id}` : `/api/coaches/${coachId}/evaluations`;
    const response = await fetch(url, {
      method: evaluation ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setSaving(false);
    if (!response?.ok || !payload?.ok) {
      setError(payload?.error ?? "저장하지 못했어요. 다시 시도해 주세요.");
      return;
    }
    onDone();
    await reload();
    if (!evaluation) setOpenId(engagementId);
  }

  function cancel() {
    if (evaluation) onDone();
    else setOpenId(null);
  }

  return (
    <section className="coach-evaluation-panel">
      <fieldset className="coach-evaluation-field">
        <legend>이번 과정 역할</legend>
        <div className="coach-evaluation-options">
          {COACH_ENGAGEMENT_ROLES.map((option) => (
            <label key={option.value}>
              <input checked={role === option.value} name={`role-${engagementId}`} onChange={() => setRole(option.value)} type="radio" />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="coach-evaluation-row">
        <label>
          실습 난이도
          <select onChange={(event) => setPracticeDifficulty(event.target.value as CoachPracticeDifficultyValue | "")} value={practiceDifficulty}>
            <option value="">선택 안 함</option>
            {COACH_PRACTICE_DIFFICULTIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          대상
          <select onChange={(event) => setAudience(event.target.value as CoachAudienceValue | "")} value={audience}>
            <option value="">선택 안 함</option>
            {COACH_AUDIENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="coach-evaluation-check">
          <input checked={isNewClient} onChange={(event) => setIsNewClient(event.target.checked)} type="checkbox" />
          신규 고객사
        </label>
      </div>

      {role ? (
        <div className="coach-evaluation-scores">
          {items.map((item) => (
            <fieldset className="coach-evaluation-field" key={item.key}>
              <legend>{item.label}</legend>
              <div className="coach-evaluation-scale">
                {Array.from({ length: item.max }, (_, index) => index + 1).map((score) => (
                  <button
                    aria-pressed={scores[item.key] === score}
                    className={scores[item.key] === score ? "active" : ""}
                    key={score}
                    onClick={() => setScores((current) => ({ ...current, [item.key]: score }))}
                    type="button"
                  >
                    {score}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="coach-evaluation-hint">4점이 기본이에요. 기대한 대로 잘 해냈으면 그대로 두세요.</p>
        </div>
      ) : (
        <p className="coach-evaluation-hint">역할을 고르면 평가 항목이 나와요.</p>
      )}

      <label className="coach-evaluation-text">
        근거 {needsEvidence ? <b>(필수)</b> : <span>(선택)</span>}
        <textarea
          maxLength={2000}
          onChange={(event) => setEvidence(event.target.value)}
          placeholder={needsEvidence ? "5점이나 3점 이하는 근거를 적어 주세요. 2점 이하는 날짜·상황까지 적어 주세요." : "남길 내용이 있으면 적어 주세요."}
          rows={3}
          value={evidence}
        />
      </label>

      <fieldset className="coach-evaluation-field">
        <legend>이 코치와 다음에도 함께하시겠어요?</legend>
        <div className="coach-evaluation-options">
          {COACH_REHIRE_INTENTS.map((option) => (
            <label key={option.value}>
              <input checked={rehire === option.value} name={`rehire-${engagementId}`} onChange={() => setRehire(option.value)} type="radio" />
              {option.label}
            </label>
          ))}
        </div>
        {rehire && rehire !== "YES" ? (
          <input
            className="coach-evaluation-reason"
            maxLength={500}
            onChange={(event) => setRehireReason(event.target.value)}
            placeholder="사유를 적어 주세요."
            value={rehireReason}
          />
        ) : null}
      </fieldset>

      {error ? <p className="coach-evaluation-error" role="alert">{error}</p> : null}
      <footer className="coach-evaluation-footer">
        <small>평가 내용은 OM·LD만 볼 수 있어요.</small>
        <span className="coach-evaluation-actions">
          <button className="coach-evaluation-button" disabled={saving} onClick={cancel} type="button">취소</button>
          <button className="coach-evaluation-button primary" disabled={saving} onClick={() => void submit()} type="button">
            {saving ? "저장 중…" : "저장"}
          </button>
        </span>
      </footer>
    </section>
  );
}
