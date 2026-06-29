"use client";

import { useState } from "react";

export function CoachInputLinkActions({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!url) {
    return <span className="coach-origin-empty-text">Skillflo 코치 URL 설정 또는 토큰 백필이 필요합니다.</span>;
  }

  async function copyUrl() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="coach-input-link-actions">
      <a href={url} rel="noreferrer" target="_blank">열기</a>
      <button onClick={copyUrl} type="button">{copied ? "복사됨" : "링크 복사"}</button>
    </div>
  );
}
