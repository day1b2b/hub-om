/**
 * UTF-8 text that was decoded as Latin-1 can appear as mojibake (for example,
 * a Korean environment-variable key). Repair that legacy form without
 * changing already valid Unicode or arbitrary non-UTF-8 text.
 */
export function normalizeLegacyUtf8Mojibake(value: string): string {
  const codePoints = Array.from(value, (character) => character.codePointAt(0) ?? 0);
  if (codePoints.some((codePoint) => codePoint > 0xff)) return value;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(codePoints));
  } catch {
    return value;
  }
}
