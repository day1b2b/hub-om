"use client";

import { checkDraftSession } from "@/lib/privacy/draftSessionCheck";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { browserDrafts, connectDraftLockEvents, lockBrowserDrafts } from "@/lib/privacy/browserDraftRuntime";
import { LegacyDraftTransitionNotice } from "./LegacyDraftTransitionNotice";

export function useBrowserDraftSession() {
  const state = useSyncExternalStore(browserDrafts.subscribe, browserDrafts.getSnapshot, browserDrafts.getServerSnapshot);
  const { data: session, status } = useSession();
  const mismatch = status === "authenticated" && state.status === "ready" && session?.browserDraftSubject !== browserDrafts.getSubject();
  // Hide the previous account synchronously, before the Provider's passive effect can lock it.
  // A null session caused by transport failure is deliberately not a confirmed identity change.
  return useMemo(() => mismatch ? { ...state, status: "locked" as const, ownerId: null } : state, [state, mismatch]);
}

/** A failed session fetch is not a logout. Only explicit sign-out, account change, or an authenticated endpoint's 401 invalidates a ready key. */
export function BrowserDraftProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const subject = session?.browserDraftSubject;
  const previous = useRef<string | null>(null);
  const state = useBrowserDraftSession();
  useEffect(() => connectDraftLockEvents(), []);
  useEffect(() => {
    if (status !== "authenticated" || !subject) return;
    if (previous.current && previous.current !== subject) lockBrowserDrafts();
    previous.current = subject;
    void browserDrafts.unlock(subject).catch(() => {});
  }, [status, subject]);
  useEffect(() => {
    const verify = async () => {
      const before = browserDrafts.getSnapshot();
      if (before.status !== "ready") return;
      const result = await checkDraftSession(previous.current);
      if (browserDrafts.getSnapshot() !== before) return;
      if (result === "denied" || result === "changed") lockBrowserDrafts();

    };
    if (status === "unauthenticated") void verify();
    window.addEventListener("online", verify); window.addEventListener("focus", verify);
    return () => { window.removeEventListener("online", verify); window.removeEventListener("focus", verify); };
  }, [status]);
  return <>
    {state.status !== "ready" && status === "authenticated" ? <div role="status" className="draft-lock-notice">
      {state.status === "loading" ? "초안 보호 기능을 준비하고 있습니다." : !subject
        ? "초안 보호 기능을 사용하려면 로그아웃 후 본인 Google 계정으로 다시 로그인해주세요. 기존 초안은 삭제하지 않습니다."
        : "초안이 잠겨 있습니다. 온라인에서 본인 계정으로 다시 연결하면 복구할 수 있습니다. 현재 입력은 이 화면을 유지해주세요."}
      {subject && state.status !== "loading" ? <button type="button" onClick={() => { void browserDrafts.unlock(subject).catch(() => {}); }}>초안 다시 연결</button> : null}
    </div> : null}
    {state.status === "ready" ? <LegacyDraftTransitionNotice key={state.generation} /> : null}
    {children}
  </>;
}
