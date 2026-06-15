"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ImportUploadPanel() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const isBusy = isUploading || isPending;

  async function uploadImport(formData: FormData) {
    setMessage("");
    setIsUploading(true);

    try {
      const response = await fetch("/api/admin/imports/upload", {
        body: formData,
        method: "POST"
      });
      const payload = (await response.json()) as {
        duplicateCount?: number;
        error?: string;
        importRunId?: string;
        ok?: boolean;
        storedCount?: number;
      };

      if (!response.ok || !payload.ok || !payload.importRunId) {
        setMessage(payload.error ?? "업로드를 저장하지 못했습니다.");
        return;
      }

      setMessage(`저장 ${payload.storedCount ?? 0}건 · 중복 ${payload.duplicateCount ?? 0}건`);
      startTransition(() => {
        router.push(`/admin/imports/${payload.importRunId}`);
        router.refresh();
      });
    } catch {
      setMessage("업로드 요청을 처리하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form action={uploadImport} className="import-upload-panel">
      <div>
        <span>Import upload</span>
        <strong>CSV/JSON을 staging DB에 저장</strong>
      </div>
      <label>
        팀
        <select name="sourceTeam" defaultValue="unknown">
          <option value="unknown">미확인</option>
          <option value="team_1">1팀</option>
          <option value="team_2">2팀</option>
        </select>
      </label>
      <label>
        원천 유형
        <input name="sourceType" placeholder="spreadsheet, gmail, slack" />
      </label>
      <label>
        원천 이름
        <input name="sourceName" placeholder="업로드 파일명 기본값" />
      </label>
      <label>
        파일
        <input accept=".csv,.json,.txt,text/csv,application/json" name="file" required type="file" />
      </label>
      <button disabled={isBusy} type="submit">
        {isBusy ? "저장 중" : "DB에 저장"}
      </button>
      {message ? <p>{message}</p> : null}
    </form>
  );
}
