"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserDrafts } from "@/lib/privacy/browserDraftRuntime";

export const LEGACY_DRAFT_NOTICE = "이전 방식의 초안이 남아 있습니다. 소유 확인 전에는 불러오거나 삭제하지 않습니다.";
export const LOCKED_DRAFT_NOTICE = "개인 초안 보관함을 준비하는 중입니다. 로그인과 연결 상태를 확인해 주세요.";

/** Inspect key names only; legacy values have no verified owner. */
export function hasLegacyDraft(key: string, storage?: Pick<Storage, "length" | "key">): boolean {
  try {
    const target = storage ?? window.localStorage;
    for (let index = 0; index < target.length; index++) if (target.key(index) === key) return true;
  } catch { /* No plaintext read or deletion on unavailable storage. */ }
  return false;
}

/** Gate at invocation time, not just after an asynchronous result resolves. */
export function runActiveDraftTask<T>(active: () => boolean, task: () => Promise<T>): Promise<T> | undefined {
  if (!active()) return undefined;
  return task();
}

export function useDraftActivity(): () => boolean {
  const [session] = useState(() => browserDrafts.getSnapshot());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return useCallback(() => {
    const current = browserDrafts.getSnapshot();
    return mounted.current && current.status === "ready" && current.ownerId === session.ownerId && current.generation === session.generation;
  }, [session]);
}
