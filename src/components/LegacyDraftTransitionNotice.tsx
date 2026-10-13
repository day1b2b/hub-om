"use client";

import { useEffect, useRef, useState } from "react";
import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { IndexedDbLegacyQuarantineStore } from "@/lib/privacy/legacyDraftQuarantineStore";
import { acknowledgeLegacyRegistration, legacyQuarantineService, transitionLegacyDrafts, withLegacyTransitionLock } from "@/lib/privacy/legacyDraftTransition";
import { replayLegacyRegistrations } from "@/lib/privacy/legacyRegistrationReplay";
import { countLegacyDrafts, legacyDraftKeys, LEGACY_REGISTRATION_UNRESOLVED, isLegacyRegistrationKey, type LegacyDraftCounts } from "@/lib/privacy/legacyDraftSources";

/** Users cannot fix these failures; the admin gets a Slack DM instead of an on-screen notice. */
function reportFailure(reason: "quarantine_failed" | "storage_unavailable" | "locks_unsupported") {
  void fetch("/api/browser-drafts/legacy-failure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }).catch(() => {});
}

export const LEGACY_TRANSITION_UPDATED = "hub-om:legacy-transition-updated";

export function LegacyDraftTransitionNotice({ email }: { email?: string | null }) {
  const [store] = useState(() => new IndexedDbLegacyQuarantineStore());
  const [counts, setCounts] = useState<LegacyDraftCounts | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [rawRegistration, setRawRegistration] = useState(false);
  const [singleWriter, setSingleWriter] = useState(false);
  const [checkedOperations, setCheckedOperations] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(true);
  const running = useRef(false);
  const autoRan = useRef(false);
  const reportedStorage = useRef(false);
  const refresh = async () => {
    try { await store.count(); } catch { /* Opening the vault early surfaces IDB failures before cleanup. */ }
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
      autoRan.current = true; setCounts(next); setAutoStart(true); return;
    }
    if (next.unavailable && !reportedStorage.current) { reportedStorage.current = true; reportFailure("storage_unavailable"); }
    setCounts(next); setUnresolved(marker); setRawRegistration(registration);
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
      if (!supportsLocks) reportFailure("locks_unsupported");
      else if (outcome.failed) reportFailure("quarantine_failed");
      setSingleWriter(false);
      await refresh();
      window.dispatchEvent(new Event(LEGACY_TRANSITION_UPDATED));
    } catch {
      if (current()) reportFailure("quarantine_failed");
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
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot trigger for the silent cleanup
    if (autoStart) { setAutoStart(false); void run(true, true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);
  // Cleanup and its failures stay silent (failures go to the admin). Only an already-sealed old registration still needs a decision.
  if (!counts || busy || !unresolved || rawRegistration || counts.unavailable) return null;
  return <section aria-label="예전 과정 등록 확인" className="draft-lock-notice">
    <p>예전에 제출하던 과정 등록이 실제로 등록됐는지 확인이 필요합니다. 확인 전까지 새 과정 등록이 막혀 있습니다.</p>
    <label><input type="checkbox" checked={checkedOperations} disabled={busy} onChange={event => setCheckedOperations(event.target.checked)} />운영 현황에서 해당 과정이 이미 등록돼 있는지 확인했습니다.</label>
    <button type="button" disabled={busy || !checkedOperations} onClick={() => void startFresh()}>확인 완료, 새 등록 허용</button>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
