// 강사 운영 메모 5칸(노션 강사위키 양식과 같음).
// 저장은 기존 instructor_notes.notes 한 칸에 "[강점]" 같은 머리말을 붙여 넣는다(DB 변경 없음).
// 머리말 없이 쓰인 예전 메모는 "비고"로 읽는다.

export const MEMO_SECTIONS = ["강점", "유의사항", "소통 스타일", "강의 스타일", "비고"] as const;

export type MemoSection = (typeof MEMO_SECTIONS)[number];

export type InstructorMemo = Record<MemoSection, string>;

const HEADER = /^\[(강점|유의사항|소통 스타일|강의 스타일|비고)\]\s*$/;

export function emptyMemo(): InstructorMemo {
  return { 강점: "", 유의사항: "", "소통 스타일": "", "강의 스타일": "", 비고: "" };
}

export function parseInstructorMemo(text: string): InstructorMemo {
  const memo = emptyMemo();
  const parts: Record<MemoSection, string[]> = { 강점: [], 유의사항: [], "소통 스타일": [], "강의 스타일": [], 비고: [] };
  let current: MemoSection = "비고";
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const header = HEADER.exec(line.trim());
    if (header) {
      current = header[1] as MemoSection;
      continue;
    }
    parts[current].push(line);
  }
  for (const section of MEMO_SECTIONS) memo[section] = parts[section].join("\n").trim();
  return memo;
}

export function serializeInstructorMemo(memo: InstructorMemo): string {
  return MEMO_SECTIONS.filter((section) => memo[section].trim())
    .map((section) => `[${section}]\n${memo[section].trim()}`)
    .join("\n\n");
}
