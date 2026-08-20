"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface NotionLinkEditorProps {
  /** 현재 항목의 강사명(저장 키). */
  name: string;
  /** 선택 가능한 노션 강사명 목록. */
  notionNames: string[];
  /** 이 항목이 노션 강사 본체인지. 본체는 연결을 받는 쪽이다. */
  isNotionEntry: boolean;
  /** 본체일 때, 이 강사로 연결돼 있는 운영 현황 표기들. */
  linkedAliases: string[];
}

/**
 * "이 사람은 노션의 이 강사" 수동 연결.
 *
 * 운영 현황에는 강사 식별자가 없어 표기가 다르면 노션 강사와 안 붙는다. 이름 자동 정규화는
 * 동명이인(김성재A/김성재B)을 합칠 위험이 있어, OM이 한 번 지정하는 방식으로 처리한다.
 *
 * 역할이 둘이다.
 * - 노션 강사 본체: 이쪽으로 연결된 표기 목록을 보여주고 해제할 수 있다.
 * - 그 외(운영 현황 표기): 연결할 노션 강사를 지정한다. 저장하면 본체 주소로 합쳐진다.
 */
export function NotionLinkEditor({ name, notionNames, isNotionEntry, linkedAliases }: NotionLinkEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "notfound">("idle");

  async function post(body: { name: string; targetName: string }) {
    setStatus("saving");
    try {
      const res = await fetch("/api/instructor-wiki/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        setStatus("error");
        return false;
      }
      setStatus("idle");
      return true;
    } catch {
      setStatus("error");
      return false;
    }
  }

  async function link() {
    const target = value.trim();
    if (!target) return;
    if (!notionNames.includes(target)) {
      setStatus("notfound");
      return;
    }
    if (await post({ name, targetName: target })) {
      setOpen(false);
      // 합쳐진 뒤에는 노션 강사명 주소가 정본이다.
      router.replace(`/instructor-wiki/${encodeURIComponent(target)}`);
      router.refresh();
    }
  }

  async function unlink(alias: string) {
    if (await post({ name: alias, targetName: "" })) {
      router.refresh();
    }
  }

  // 본체: 연결된 표기 관리만 한다.
  if (isNotionEntry) {
    if (linkedAliases.length === 0) return null;
    return (
      <span className="notion-link-editor">
        <span className="notion-chip is-off">연결된 표기 {linkedAliases.length}건</span>
        {linkedAliases.map((alias) => (
          <span className="notion-link-alias" key={alias}>
            {alias}
            <button
              aria-label={`${alias} 연결 해제`}
              disabled={status === "saving"}
              onClick={() => unlink(alias)}
              type="button"
            >
              ✕
            </button>
          </span>
        ))}
        {status === "error" ? <span className="editor-status is-error">해제 실패</span> : null}
      </span>
    );
  }

  if (!open) {
    return (
      <button className="notion-chip is-link" onClick={() => setOpen(true)} type="button">
        ＋ 노션 강사 연결
      </button>
    );
  }

  return (
    <span className="notion-link-editor">
      <input
        aria-label="연결할 노션 강사명"
        className="wiki-input"
        list="notion-instructor-names"
        onChange={(event) => {
          setValue(event.target.value);
          setStatus("idle");
        }}
        placeholder="노션 강사명 입력"
        value={value}
      />
      <datalist id="notion-instructor-names">
        {notionNames.map((notionName) => (
          <option key={notionName} value={notionName} />
        ))}
      </datalist>
      <button className="editor-save" disabled={status === "saving"} onClick={link} type="button">연결</button>
      <button
        className="editor-cancel"
        disabled={status === "saving"}
        onClick={() => {
          setValue("");
          setStatus("idle");
          setOpen(false);
        }}
        type="button"
      >
        취소
      </button>
      {status === "notfound" ? <span className="editor-status is-error">노션 명단에 없는 이름입니다</span> : null}
      {status === "error" ? <span className="editor-status is-error">저장 실패</span> : null}
    </span>
  );
}
