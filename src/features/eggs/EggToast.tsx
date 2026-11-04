"use client";

import { useEffect, useRef } from "react";

const TOAST_DURATION_MS = 2500;

interface EggToastProps {
  message: string | null;
  onDone: () => void;
}

/** 처리 완료 문구를 화면 위쪽에 잠깐 띄웠다가 지운다. 실패 문구는 토스트로 쓰지 않고 그 자리에 남긴다. */
export function EggToast({ message, onDone }: EggToastProps) {
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => onDoneRef.current(), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div className="egg-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
