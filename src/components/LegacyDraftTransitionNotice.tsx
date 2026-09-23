"use client";

import { useEffect, useRef, useState } from "react";
import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { IndexedDbLegacyQuarantineStore } from "@/lib/privacy/legacyDraftQuarantineStore";
import { acknowledgeLegacyRegistration, legacyQuarantineService, transitionLegacyDrafts, withLegacyTransitionLock, type LegacyTransitionResult } from "@/lib/privacy/legacyDraftTransition";
import { countLegacyDrafts, legacyDraftKeys, LEGACY_REGISTRATION_UNRESOLVED, isLegacyRegistrationKey, type LegacyDraftCounts } from "@/lib/privacy/legacyDraftSources";

export const LEGACY_TRANSITION_UPDATED = "hub-om:legacy-transition-updated";

export function LegacyDraftTransitionNotice() {
  const [store] = useState(() => new IndexedDbLegacyQuarantineStore());
  const [counts, setCounts] = useState<LegacyDraftCounts | null>(null);
  const [copies, setCopies] = useState<number | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [rawRegistration, setRawRegistration] = useState(false);
  const [singleWriter, setSingleWriter] = useState(false);
  const [checkedOperations, setCheckedOperations] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LegacyTransitionResult | null>(null);
  const [message, setMessage] = useState("");
  const active = useRef(true);
  const running = useRef(false);
  const refresh = async () => {
    let count: number | null = null;
    try { count = await store.count(); } catch { /* Unknown is distinct from empty. */ }
    if (!active.current) return;
    // Inspect sources after the asynchronous IDB count so a stale refresh cannot report an old all-clear.
    const next = countLegacyDrafts();
    let marker = false, registration = false;
    try {
      const local = window.localStorage;
      marker = local.getItem(LEGACY_REGISTRATION_UNRESOLVED) !== null;
      registration = [local, window.sessionStorage].some(storage => legacyDraftKeys(storage).some(isLegacyRegistrationKey));
    } catch { next.unavailable = true; }
    setCounts(next); setCopies(count); setUnresolved(marker); setRawRegistration(registration);
  };
  useEffect(() => {
    active.current = true;
    const update = () => { void refresh(); };
    update();
    window.addEventListener("storage", update); window.addEventListener("focus", update);
    return () => { active.current = false; window.removeEventListener("storage", update); window.removeEventListener("focus", update); };
    // This instance owns a stable store; account changes remount it in the Provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  async function run(removeLocal: boolean) {
    if (running.current || (removeLocal && !singleWriter)) return;
    running.current = true; setBusy(true); setMessage("");
    const initial = browserDrafts.getSnapshot();
    const current = () => active.current && browserDrafts.getSnapshot() === initial && initial.status === "ready";
    try {
      const supportsLocks = !!navigator.locks;
      const execute = () => transitionLegacyDrafts({ store, service: legacyQuarantineService(), current, removeSession: supportsLocks, removeLocal: supportsLocks && removeLocal });
      const outcome = supportsLocks ? await withLegacyTransitionLock(execute) : await execute();
      if (!current()) return;
      setResult(outcome);
      setMessage(supportsLocks ? "" : "안전한 전환 잠금을 지원하지 않아 암호화 사본만 보관했습니다. 원문은 유지합니다.");
      setSingleWriter(false);
      await refresh();
      window.dispatchEvent(new Event(LEGACY_TRANSITION_UPDATED));
    } catch {
      if (current()) setMessage("보호 절차를 완료하지 못했습니다. 제거하지 않은 원문과 저장된 암호문은 유지합니다. 연결과 저장 공간을 확인하고 다시 시도해주세요.");
    } finally { running.current = false; if (active.current) setBusy(false); }
  }
  async function startFresh() {
    if (running.current || !checkedOperations) return;
    running.current = true; setBusy(true); setMessage("");
    const initial = browserDrafts.getSnapshot();
    try {
      await acknowledgeLegacyRegistration(undefined, () => active.current && browserDrafts.getSnapshot() === initial && initial.status === "ready");
      if (!active.current) return;
      setCheckedOperations(false); await refresh();
      setMessage("옛 등록 정보는 암호화 보관함에 유지했습니다. 새 등록은 새로운 요청으로 시작합니다.");
      window.dispatchEvent(new Event(LEGACY_TRANSITION_UPDATED));
    } catch { if (active.current) setMessage("등록 확인 표시를 정리하지 못했습니다. 기존 차단을 유지합니다. 보호 절차와 연결 상태를 확인해주세요."); }
    finally { running.current = false; if (active.current) setBusy(false); }
  }
  if (!counts || (!counts.unavailable && !counts.localStorage && !counts.sessionStorage && copies === 0 && !unresolved && !message)) return null;
  const needsAttention = counts.unavailable || copies === null || counts.localStorage + counts.sessionStorage > 0 || unresolved || busy || !!message || !!result?.failed;
  return <section aria-label="이전 초안 보호" className="draft-lock-notice">
    <details open={needsAttention}>
    <summary>{needsAttention ? "이전 초안 보호" : `현재 확인 범위의 원문 정리 완료 · 암호화 사본 ${copies}건 보관`}</summary>
    <p>옛 초안은 현재 계정에 자동 연결하거나 내용을 표시하지 않고, 별도 암호화 보관함에 보존합니다. 원문은 저장과 복호화 검증이 끝난 항목만 제거합니다.</p>
    <p>현재 탭에서 감지한 원문: 탭 보관 {counts.sessionStorage}건 · 브라우저 공유 보관 {counts.localStorage}건. 암호화 사본: {copies === null ? "확인하지 못함" : `${copies}건`}.</p>
    {counts.unavailable ? <p role="alert">일부 저장소를 확인하지 못했습니다. 원문이 없다고 확인할 수 없습니다.</p> : null}
    {counts.sessionStorage + counts.localStorage > 0 ? <>
      <p>다른 앱 탭을 바로 닫지 마세요. 각 탭에서 작성 중 입력을 저장하고 새로고침한 뒤 이 보호 절차를 진행하세요. 탭을 먼저 닫으면 그 탭의 초안을 잃을 수 있습니다.</p>
      <button type="button" disabled={busy} onClick={() => void run(false)}>암호화 보관 시작</button>
      {counts.localStorage > 0 ? <>
        <p>공유 원문 제거 전, 다른 앱 탭·창·앱이 열린 프레임에서도 보호 절차를 마친 뒤 닫아주세요. 이 화면은 다른 탭의 중단 여부를 자동 확인할 수 없습니다.</p>
        <label><input type="checkbox" checked={singleWriter} disabled={busy} onChange={event => setSingleWriter(event.target.checked)} />다른 앱 탭·창·프레임의 보호 절차를 마치고 닫았습니다. 완료 전까지 새로 열지 않겠습니다.</label>
        <button type="button" disabled={busy || !singleWriter} onClick={() => void run(true)}>공유 원문 재검증 후 제거</button>
      </> : null}
    </> : null}
    {busy ? <p role="status">암호화 보관과 저장 검증 중입니다. 이 탭을 닫지 마세요.</p> : null}
    {result ? <p role="status">이번 실행: 검증된 사본 {result.copied}건 · 원문 제거 {result.removed}건 · 변경 감지 {result.changed}건 · 미완료 {result.failed}건. 남은 원문은 위 감지 수를 확인해주세요.</p> : null}
    <p>확인 범위는 이 브라우저의 공유 저장소와 현재 탭입니다. 다른 탭·기기의 초안까지 전환됐다는 뜻은 아닙니다. 남은 원문이 있으면 보관을 다시 진행해주세요.</p>
    {unresolved || rawRegistration ? <p>옛 등록 정보의 서버 반영 여부가 미확정입니다. 격리 보관만으로 신규 등록 차단을 풀지 않습니다.</p> : null}
    {unresolved && !rawRegistration && !counts.unavailable ? <>
      <label><input type="checkbox" checked={checkedOperations} disabled={busy} onChange={event => setCheckedOperations(event.target.checked)} />운영 현황에서 기존 등록 여부를 확인했습니다. 옛 등록을 재개하지 않고 새 등록을 시작합니다.</label>
      <button type="button" disabled={busy || !checkedOperations} onClick={() => void startFresh()}>확인 후 새 등록 허용</button>
    </> : null}
    {message ? <p role="status">{message}</p> : null}
    </details>
  </section>;
}
