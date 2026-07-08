export const WORK_TYPE_ORDER = ["운영조교", "실습코치", "삼전 DS", "삼전 DX", "보조강사", "멘토"] as const;

type WorkType = (typeof WORK_TYPE_ORDER)[number];

const WORK_TYPE_SET = new Set<string>(WORK_TYPE_ORDER);

function splitTokens(raw: string): string[] {
  return raw.split(/[,/\n]/).map((value) => value.trim()).filter(Boolean);
}

function normalizeToken(token: string): WorkType | null {
  const text = token.trim();
  if (!text) return null;
  if (WORK_TYPE_SET.has(text)) return text as WorkType;

  if (/운영\s*조교/.test(text)) return "운영조교";
  if (/실습\s*코치/.test(text)) return "실습코치";
  if (/보조\s*강사/.test(text)) return "보조강사";
  if (/멘토/.test(text)) return "멘토";

  const upper = text.replace(/\s+/g, "").toUpperCase();
  if (/(삼전|삼성).*DS/.test(text) || upper === "DS" || upper === "삼전DS" || upper === "삼성DS") {
    return "삼전 DS";
  }
  if (/(삼전|삼성).*DX/.test(text) || upper === "DX" || upper === "삼전DX" || upper === "삼성DX") {
    return "삼전 DX";
  }

  return null;
}

export function normalizeWorkTypeString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const found = new Set<WorkType>();
  for (const token of splitTokens(raw)) {
    const normalized = normalizeToken(token);
    if (normalized) found.add(normalized);
  }
  const ordered = WORK_TYPE_ORDER.filter((value) => found.has(value));
  return ordered.length > 0 ? ordered.join(", ") : null;
}

export function mergeWorkTypeStrings(...inputs: Array<string | null | undefined>): string | null {
  return normalizeWorkTypeString(inputs.filter(Boolean).join(", "));
}
