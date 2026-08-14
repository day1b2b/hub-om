"use client";

import { useEffect, useRef } from "react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const TEXT_COLORS = [
  { label: "기본", value: "#111827" },
  { label: "빨강", value: "#dc2626" },
  { label: "파랑", value: "#2563eb" },
  { label: "초록", value: "#16a34a" },
  { label: "주황", value: "#d97706" },
  { label: "보라", value: "#7c3aed" }
];

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !editorRef.current) return;
    initialized.current = true;
    editorRef.current.innerHTML = value;
  }, [value]);

  function emitChange() {
    onChange(editorRef.current?.innerHTML ?? "");
  }

  function applyCommand(command: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  }

  function handleLink() {
    editorRef.current?.focus();
    const url = window.prompt("연결할 링크 주소를 입력하세요 (예: https://example.com)");
    if (!url) return;
    applyCommand("createLink", url);
  }

  function handleColor(color: string) {
    editorRef.current?.focus();
    document.execCommand("styleWithCSS", false, "true");
    applyCommand("foreColor", color);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const html = text
      .split(/\r\n|\r|\n/)
      .map((line) => escapeHtml(line))
      .join("<br>");
    document.execCommand("insertHTML", false, html);
    emitChange();
  }

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar" role="toolbar" aria-label="텍스트 서식">
        <button type="button" onClick={() => applyCommand("bold")} title="굵게">
          <strong>B</strong>
        </button>
        <button type="button" onClick={() => applyCommand("underline")} title="밑줄">
          <span style={{ textDecoration: "underline" }}>U</span>
        </button>
        <button type="button" onClick={handleLink} title="링크 연결">
          링크
        </button>
        <span className="rich-text-toolbar-divider" />
        {TEXT_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            className="rich-text-color-swatch"
            onClick={() => handleColor(color.value)}
            title={color.label}
            style={{ backgroundColor: color.value }}
          />
        ))}
      </div>
      <div
        ref={editorRef}
        className="rich-text-editable"
        contentEditable
        onInput={emitChange}
        onPaste={handlePaste}
        suppressContentEditableWarning
      />
    </div>
  );
}
