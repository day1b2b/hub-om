"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ImportUploadPanel() {
  const router = useRouter();
  const [importYear, setImportYear] = useState(2026);
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
    <section className="import-entry-section" aria-label="운영 현황 일괄 등록">
      <div className="sheet-import-panel">
        <div className="sheet-import-heading">
          <div>
            <span>엑셀 업로드</span>
            <strong>운영 현황 일괄 등록</strong>
            <p>
              엑셀 파일을 올리면 먼저 검토 대기 상태로 저장됩니다. 아래 표에서 확인한 뒤 운영 현황(/operations)에
              반영하세요. 양식에는 (예시) 행이 들어 있으니, 그 행을 지우거나 실제 값으로 바꿔서 올려주세요.
            </p>
          </div>
          <a className="primary-link" download href="/api/admin/imports/template">
            양식 다운로드
          </a>
        </div>

        <form action={uploadImport} className="import-upload-panel">
          <label>
            기준 연도
            <input
              max={2100}
              min={2000}
              name="importYear"
              onChange={(event) => setImportYear(Number(event.target.value) || 2026)}
              type="number"
              value={importYear}
            />
          </label>
          <label>
            엑셀 파일
            <input
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              name="file"
              required
              type="file"
            />
          </label>
          <button disabled={isBusy} type="submit">
            {isBusy ? "올리는 중" : "파일 올리고 검토하기"}
          </button>
          {message ? <p className="import-message">{message}</p> : null}
        </form>
      </div>
    </section>
  );
}
