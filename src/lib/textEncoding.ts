/**
 * UTF-8 text that was decoded as Latin-1 can appear as mojibake (for example,
 * a Korean environment-variable key). Repair that legacy form without
 * changing already valid Unicode or arbitrary non-UTF-8 text.
 */
export function normalizeLegacyUtf8Mojibake(value: string): string {
  let normalized = value;

  // Coolify를 거치는 동안 같은 오해석이 두 번 적용된 레거시 값도 있다.
  // 무한 반복을 막고 실제로 관측된 범위보다 한 단계 여유 있게 복구한다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const codePoints = Array.from(normalized, (character) => character.codePointAt(0) ?? 0);
    if (codePoints.some((codePoint) => codePoint > 0xff)) return normalized;

    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(codePoints));
      if (decoded === normalized) return normalized;
      normalized = decoded;
    } catch {
      return normalized;
    }
  }

  return normalized;
}
