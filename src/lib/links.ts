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
