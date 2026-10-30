const SCHEME_PATTERN = /^(https?:\/\/|slack:\/\/)/i;
const BARE_DOMAIN_PATTERN = /^www\.[^\s/]+\.[a-z]{2,}(\/\S*)?$/i;

export function isNavigableHref(value: string): boolean {
  return toHref(value) !== null;
}

export function toHref(value: string): string | null {
  const trimmed = value.trim();

  if (SCHEME_PATTERN.test(trimmed)) return trimmed;
  if (BARE_DOMAIN_PATTERN.test(trimmed)) return `https://${trimmed}`;

  return null;
}

const EMBEDDED_URL_PATTERN = /https?:\/\/[^\s<>"'）)\]]+/i;

/**
 * 링크 칸에 열 수 있는 주소가 없으면, 메모 같은 다른 칸 안에 적힌 첫 http(s) 주소를 찾는다. 예전에 회차
 * 메모에 링크를 적어 둔 값이 과정 칸으로 옮겨져 "등록됨"으로만 보이고 열 수 없던 문제를 막기 위해서다.
 */
export function findLinkHref(...values: string[]): string | null {
  for (const value of values) {
    const direct = toHref(value);
    if (direct) return direct;
  }
  for (const value of values) {
    const embedded = EMBEDDED_URL_PATTERN.exec(value)?.[0];
    if (embedded) return embedded;
  }
  return null;
}
