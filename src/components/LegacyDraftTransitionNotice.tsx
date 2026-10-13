"use client";

import { useEffect } from "react";
import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { IndexedDbLegacyQuarantineStore } from "@/lib/privacy/legacyDraftQuarantineStore";
import { acknowledgeLegacyRegistration, legacyQuarantineService, transitionLegacyDrafts, withLegacyTransitionLock } from "@/lib/privacy/legacyDraftTransition";
import { replayLegacyRegistrations } from "@/lib/privacy/legacyRegistrationReplay";
import { countLegacyDrafts, legacyDraftKeys, LEGACY_REGISTRATION_UNRESOLVED, isLegacyRegistrationKey } from "@/lib/privacy/legacyDraftSources";

export const LEGACY_TRANSITION_UPDATED = "hub-om:legacy-transition-updated";

/** Users cannot fix these failures; the admin gets a Slack DM instead of an on-screen notice. */
function reportFailure(reason: "quarantine_failed" | "locks_unsupported") {
  void fetch("/api/browser-drafts/legacy-failure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }).catch(() => {});
}

function hasRegistration(): boolean {
  return [window.localStorage, window.sessionStorage].some(storage => legacyDraftKeys(storage).some(isLegacyRegistrationKey));
}

/**
 * Silently moves old-format drafts into the encrypted vault. Nothing is shown to the user:
 * - old registrations are resent with their original Idempotency-Key first, so the server decides "already created" or creates it;
 * - failures keep the plaintext for the next visit and DM the admin;
 * - an old registration already sealed before replay existed no longer blocks new registration (decided 2026-10-13:
 *   it predates 2026-09-21, so a missing course would have been noticed and re-registered). Its encrypted copy is kept.
 */
async function cleanUp(email: string | null | undefined, current: () => boolean): Promise<void> {
  const counts = countLegacyDrafts();
  if (counts.unavailable) return; // Private mode etc.: nobody can fix it, so no alert.
  if (counts.localStorage + counts.sessionStorage > 0) {
    if (hasRegistration() && (!email || await replayLegacyRegistrations(email) === "retry")) return; // Retry on the next visit.
    if (!navigator.locks) { reportFailure("locks_unsupported"); return; }
    // Removal re-reads each value and skips anything changed meanwhile, so no manual tab check is needed.
    const outcome = await withLegacyTransitionLock(() => transitionLegacyDrafts({ store: new IndexedDbLegacyQuarantineStore(), service: legacyQuarantineService(), current, removeSession: true, removeLocal: true }));
    if (outcome.failed) reportFailure("quarantine_failed");
  }
  if (!current()) return;
  if (window.localStorage.getItem(LEGACY_REGISTRATION_UNRESOLVED) !== null && !hasRegistration()) await acknowledgeLegacyRegistration(undefined, current);
  window.dispatchEvent(new Event(LEGACY_TRANSITION_UPDATED));
}

export function LegacyDraftTransitionNotice({ email }: { email?: string | null }) {
  useEffect(() => {
    let active = true;
    const initial = browserDrafts.getSnapshot();
    const current = () => active && browserDrafts.getSnapshot() === initial && initial.status === "ready";
    void cleanUp(email, current).catch(() => { if (current()) reportFailure("quarantine_failed"); });
    return () => { active = false; };
  }, [email]);
  return null;
}
