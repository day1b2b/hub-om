"use client";

import { useEffect, useRef, useState } from "react";
import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { IndexedDbLegacyQuarantineStore } from "@/lib/privacy/legacyDraftQuarantineStore";
import { acknowledgeLegacyRegistration, legacyQuarantineService, transitionLegacyDrafts, withLegacyTransitionLock, type LegacyTransitionResult } from "@/lib/privacy/legacyDraftTransition";
import { replayLegacyRegistrations } from "@/lib/privacy/legacyRegistrationReplay";
import { countLegacyDrafts, countLegacyDraftsByKind, LEGACY_DRAFT_LABELS, legacyDraftKeys, LEGACY_REGISTRATION_UNRESOLVED, isLegacyRegistrationKey, type LegacyDraftCounts } from "@/lib/privacy/legacyDraftSources";

export const LEGACY_TRANSITION_UPDATED = "hub-om:legacy-transition-updated";

export function LegacyDraftTransitionNotice({ email }: { email?: string | null }) {
  const [store] = useState(() => new IndexedDbLegacyQuarantineStore());
  const [counts, setCounts] = useState<LegacyDraftCounts | null>(null);
  const [byKind, setByKind] = useState<number[]>([]);
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
  const autoRan = useRef(false);
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
    if (!autoRan.current && !next.unavailable && next.localStorage + next.sessionStorage > 0) {
      // Removal re-reads each value and skips anything changed meanwhile, so no manual tab check is needed.
      autoRan.current = true; setCounts(next); void run(true, true); return;
    }
    setCounts(next); setByKind(countLegacyDraftsByKind()); setCopies(count); setUnresolved(marker); setRawRegistration(registration);
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

  async function run(removeLocal: boolean, auto = false) {
    if (running.current || (removeLocal && !singleWriter && !auto)) return;
    running.current = true; setBusy(true); setMessage("");
    const initial = browserDrafts.getSnapshot();
    const current = () => active.current && browserDrafts.getSnapshot() === initial && initial.status === "ready";
    try {
      const supportsLocks = !!navigator.locks;
      // Resend old registrations with their original Idempotency-Key before their plaintext is removed.
      let replayed = false;
      if (auto) {
        const hadMarker = window.localStorage.getItem(LEGACY_REGISTRATION_UNRESOLVED) !== null;
        const hasRegistration = [window.localStorage, window.sessionStorage].some(storage => legacyDraftKeys(storage).some(isLegacyRegistrationKey));
        if (hasRegistration) {
          if (!email || await replayLegacyRegistrations(email) === "retry") return; // Try again on the next visit.
          replayed = !hadMarker;
        }
      }
      const execute = () => transitionLegacyDrafts({ store, service: legacyQuarantineService(), current, removeSession: supportsLocks, removeLocal: supportsLocks && removeLocal });
      const outcome = supportsLocks ? await withLegacyTransitionLock(execute) : await execute();
      if (!current()) return;
      if (replayed && outcome.remaining.localStorage + outcome.remaining.sessionStorage === 0) await acknowledgeLegacyRegistration(undefined, current);
      setResult(outcome);
      setMessage(supportsLocks ? "" : "이 브라우저는 안전한 정리를 지원하지 않아 보관만 하고 원래 내용은 남겨두었습니다. 최신 Chrome에서 다시 시도해주세요.");
      setSingleWriter(false);
      await refresh();
      window.dispatchEvent(new Event(LEGACY_TRANSITION_UPDATED));
    } catch {
      if (current()) setMessage("정리하지 못했습니다. 작성 내용은 그대로 남아 있습니다. 인터넷 연결을 확인하고 다시 눌러주세요.");
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
      setMessage("확인했습니다. 이제 과정을 새로 등록할 수 있습니다.");
      window.dispatchEvent(new Event(LEGACY_TRANSITION_UPDATED));
    } catch { if (active.current) setMessage("처리하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러주세요."); }
    finally { running.current = false; if (active.current) setBusy(false); }
  }
  // Normal cleanup runs silently; only failures and the registration decision need the user.
  if (!counts || busy || !(message || result?.failed || result?.changed || unresolved || rawRegistration)) return null;
  const needsAttention = counts.unavailable || copies === null || counts.localStorage + counts.sessionStorage > 0 || unresolved || busy || !!message || !!result?.failed;
  const pending = counts.localStorage + counts.sessionStorage;
  const kinds = byKind.map((n, i) => n ? `${LEGACY_DRAFT_LABELS[i]} ${n}건` : "").filter(Boolean).join(", ");
  return <section aria-label="예전 작성 내용 정리" className="draft-lock-notice">
    <details open={needsAttention}>
    <summary>{needsAttention ? "예전 작성 내용 정리가 필요합니다" : "예전 작성 내용 정리 완료"}</summary>
    {pending > 0 ? <>
      <p>이 브라우저에 예전 방식으로 저장된 작성 중 내용 {pending}건이 있습니다{kinds ? ` (${kinds})` : ""}. 아래 순서대로 한 번만 정리해주세요. 내용은 지워지지 않고 안전한 보관함으로 옮겨집니다.</p>
      <ol>
        <li>hub-om이 열린 다른 탭·창이 있으면 작성 중인 내용을 저장하고 닫아주세요. hub-om은 이 탭 하나만 남겨주세요.</li>
        {counts.localStorage > 0 ? <li><label><input type="checkbox" checked={singleWriter} disabled={busy} onChange={event => setSingleWriter(event.target.checked)} />다른 hub-om 탭·창을 모두 닫았습니다.</label></li> : null}
        <li><button type="button" disabled={busy || (counts.localStorage > 0 && !singleWriter)} onClick={() => void run(counts.localStorage > 0)}>보관하고 정리하기</button></li>
      </ol>
    </> : !needsAttention ? <p>정리할 내용이 없습니다. 예전 작성 내용 {copies}건은 보관함에 안전하게 보관 중입니다.</p> : null}
    {counts.unavailable ? <p role="alert">브라우저 저장 공간을 확인하지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}
    {copies === null ? <p role="alert">보관함 상태를 확인하지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}
    {busy ? <p role="status">정리 중입니다. 이 탭을 닫지 마세요.</p> : null}
    {result ? <p role="status">{result.failed || result.changed ? `일부를 정리하지 못했습니다 (보관 ${result.copied}건, 정리 ${result.removed}건, 미완료 ${result.failed + result.changed}건). 다시 눌러주세요.` : `정리했습니다 (보관 ${result.copied}건, 정리 ${result.removed}건).`}</p> : null}
    {unresolved || rawRegistration ? <p>예전에 제출하던 과정 등록이 실제로 등록됐는지 확인이 필요합니다. 확인 전까지 새 과정 등록이 막혀 있습니다.</p> : null}
    {unresolved && !rawRegistration && !counts.unavailable ? <>
      <label><input type="checkbox" checked={checkedOperations} disabled={busy} onChange={event => setCheckedOperations(event.target.checked)} />운영 현황에서 해당 과정이 이미 등록돼 있는지 확인했습니다.</label>
      <button type="button" disabled={busy || !checkedOperations} onClick={() => void startFresh()}>확인 완료, 새 등록 허용</button>
    </> : null}
    {message ? <p role="status">{message}</p> : null}
    </details>
  </section>;
}
