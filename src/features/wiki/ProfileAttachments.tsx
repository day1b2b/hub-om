"use client";

import { useRef, useState, type ChangeEvent } from "react";

// 강사 프로필 파일 첨부. 파일 선택 미리보기(파일명 표시)까지 동작.
// 실제 업로드·저장은 백엔드 파일 저장 연동 시.
export function ProfileAttachments() {
  const [files, setFiles] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []).map((file) => file.name);
    if (picked.length > 0) setFiles((current) => [...current, ...picked]);
    event.target.value = "";
  }

  function remove(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  return (
    <div className="profile-attach">
      <input ref={inputRef} type="file" multiple hidden onChange={onPick} aria-label="파일 첨부" />
      {files.length > 0 ? (
        <ul className="attach-list">
          {files.map((name, index) => (
            <li key={`${name}-${index}`}>
              <span>📎 {name}</span>
              <button className="attach-remove" type="button" onClick={() => remove(index)} aria-label="첨부 삭제">✕</button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="td-muted">첨부된 파일 없음</span>
      )}
      <div>
        <button className="doc-register" type="button" onClick={() => inputRef.current?.click()}>＋ 파일 첨부</button>
      </div>
      <p className="field-hint">파일 선택 미리보기예요. 실제 업로드·저장은 백엔드 파일 저장 연동 시 반영됩니다.</p>
    </div>
  );
}
