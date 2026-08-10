export interface ToolGroup {
  category: string;
  tools: string[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  { category: "생성형 AI", tools: ["ChatGPT", "Claude", "Claude Code", "Gemini", "Gemini Enterprise", "NotebookLM", "A.Biz"] },
  { category: "Microsoft", tools: ["Microsoft 365 Copilot", "Copilot Studio", "Excel", "PowerPoint", "VBA"] },
  { category: "Google/협업", tools: ["Google Workspace", "Notion"] },
  { category: "개발·데이터", tools: ["Python", "SQL", "R", "Git", "Jupyter", "VS Code"] },
  { category: "AI 개발", tools: ["RAG", "LangChain", "Hugging Face", "PyTorch", "TensorFlow"] },
  { category: "제작 (실제 확인 후 선택)", tools: ["Canva", "Midjourney", "Adobe Firefly", "Runway"] }
];

export const TOOL_META_OPTIONS = ["미확인", "해당 없음"];

function builtinToolSet(): Set<string> {
  return new Set([...TOOL_GROUPS.flatMap((group) => group.tools), ...TOOL_META_OPTIONS]);
}

function splitToolsValue(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseToolsValue(value: string, extraKnownTools: string[] = []): { custom: string; selected: Set<string> } {
  const known = new Set([...builtinToolSet(), ...extraKnownTools]);
  const items = splitToolsValue(value);
  return {
    custom: items.filter((item) => !known.has(item)).join(", "),
    selected: new Set(items.filter((item) => known.has(item)))
  };
}

// "기타 직접입력" 칸에만 있던, 아직 목록에 없는 도구명을 뽑아낸다. 신규 도구를 커스텀 목록에 추가할 때 쓴다.
export function extractUnknownTools(value: string, extraKnownTools: string[] = []): string[] {
  const known = new Set([...builtinToolSet(), ...extraKnownTools]);
  return Array.from(new Set(splitToolsValue(value).filter((item) => !known.has(item))));
}
