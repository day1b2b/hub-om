"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseToolsValue, TOOL_GROUPS, TOOL_META_OPTIONS } from "@/lib/data/omRequest/omToolOptions";

type SaveState = "idle" | "saving" | "failed";

interface EditableToolsItemProps {
  displayValue: string;
  extraTools?: string[];
  operationId: string;
  value: string;
}

export function EditableToolsItem({ displayValue, extraTools = [], operationId, value: rawValue }: EditableToolsItemProps) {
  const router = useRouter();
  const value = rawValue ?? "";
  const [isOpen, setIsOpen] = useState(false);
  const [{ custom: initialCustomTools, selected: initialSelectedTools }] = useState(() =>
    parseToolsValue(value, extraTools)
  );
  const [selectedTools, setSelectedTools] = useState(initialSelectedTools);
  const [customTools, setCustomTools] = useState(initialCustomTools);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  return (
    <div className="info-item editable-info-item">
      <span>사용 Tool</span>
      <div className="info-item-value-row">
        <strong>{displayValue}</strong>
        <button className="info-item-edit-trigger" onClick={openDialog} type="button">
          수정
        </button>
      </div>

      {isOpen ? (
        <div aria-modal="true" className="drive-review-modal" role="dialog">
          <div className="drive-review-backdrop" onClick={closeDialog} />
          <section aria-labelledby="tools-edit-title" className="drive-review-dialog lecture-note-dialog">
            <div className="drive-review-header">
              <div>
                <h2 id="tools-edit-title">사용 Tool 수정</h2>
                <p>등록된 목록에서 사용한 Tool을 선택합니다.</p>
              </div>
              <button aria-label="사용 Tool 수정 닫기" onClick={closeDialog} type="button">
                닫기
              </button>
            </div>

            <div className="lecture-note-body">
              <div className="om-tool-groups">
                {TOOL_GROUPS.map((group) => (
                  <div className="om-tool-group" key={group.category}>
                    <span className="om-tool-group-title">{group.category}</span>
                    <div className="om-tool-group-options">
                      {group.tools.map((tool) => (
                        <label className="inline-toggle" key={tool}>
                          <input checked={selectedTools.has(tool)} onChange={() => toggleTool(tool)} type="checkbox" />
                          <span>{tool}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {extraTools.length > 0 ? (
                  <div className="om-tool-group">
                    <span className="om-tool-group-title">추가된 도구</span>
                    <div className="om-tool-group-options">
                      {extraTools.map((tool) => (
                        <label className="inline-toggle" key={tool}>
                          <input checked={selectedTools.has(tool)} onChange={() => toggleTool(tool)} type="checkbox" />
                          <span>{tool}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="om-tool-group">
                  <span className="om-tool-group-title">기타</span>
                  <div className="om-tool-group-options">
                    {TOOL_META_OPTIONS.map((meta) => (
                      <label className="inline-toggle" key={meta}>
                        <input checked={selectedTools.has(meta)} onChange={() => toggleTool(meta)} type="checkbox" />
                        <span>{meta}</span>
                      </label>
                    ))}
                  </div>
                  <input
                    className="om-tool-custom-input"
                    onChange={(event) => setCustomTools(event.target.value)}
                    placeholder="목록에 없는 도구는 직접 입력 (쉼표로 구분)"
                    type="text"
                    value={customTools}
                  />
                </div>
              </div>
            </div>

            <div className="lecture-note-footer">
              {saveState === "failed" ? <span className="lecture-note-save-error">저장하지 못했습니다.</span> : null}
              <div className="lecture-note-actions">
                <button disabled={saveState === "saving"} onClick={closeDialog} type="button">
                  취소
                </button>
                <button disabled={saveState === "saving"} onClick={save} type="button">
                  {saveState === "saving" ? "저장 중" : "저장"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );

  function toggleTool(tool: string) {
    setSelectedTools((current) => {
      const next = new Set(current);
      const isMeta = TOOL_META_OPTIONS.includes(tool);

      if (next.has(tool)) {
        next.delete(tool);
      } else if (isMeta) {
        next.clear();
        next.add(tool);
      } else {
        TOOL_META_OPTIONS.forEach((meta) => next.delete(meta));
        next.add(tool);
      }

      return next;
    });
  }

  function openDialog() {
    const parsed = parseToolsValue(value, extraTools);
    setSelectedTools(parsed.selected);
    setCustomTools(parsed.custom);
    setSaveState("idle");
    setIsOpen(true);
  }

  function closeDialog() {
    const parsed = parseToolsValue(value, extraTools);
    setSelectedTools(parsed.selected);
    setCustomTools(parsed.custom);
    setSaveState("idle");
    setIsOpen(false);
  }

  async function save() {
    setSaveState("saving");

    const nextValue = [...selectedTools, ...(customTools.trim() ? [customTools.trim()] : [])].join(", ");
    const patches = [{ field: "tools", action: "replace" as const, value: nextValue }];

    let response: Response;

    try {
      response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/drive-import/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ patches })
      });
    } catch {
      setSaveState("failed");
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean };

    if (!response.ok || !payload.ok) {
      setSaveState("failed");
      return;
    }

    setIsOpen(false);
    setSaveState("idle");
    router.refresh();
  }
}
