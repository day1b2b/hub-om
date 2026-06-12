export function summarizeSatisfactionValue(value: string): string {
  const match = value.replace(",", ".").match(/\b(?:[0-5](?:\.\d{1,2})?|5\.0{1,2})\b/);
  if (!match) return "";

  const score = Number(match[0]);
  if (!Number.isFinite(score) || score < 0 || score > 5) return "";

  return score.toFixed(2);
}

export function satisfactionNumber(value: string): number | null {
  const summarized = summarizeSatisfactionValue(value);
  if (!summarized) return null;

  const parsed = Number(summarized);
  return Number.isFinite(parsed) ? parsed : null;
}
