const TOKEN_PLACEHOLDER = "{token}";

export function buildSkillfloCoachUrl(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;

  const template = process.env.SKILLFLO_COACH_URL_TEMPLATE?.trim();
  if (!template) return null;

  if (template.includes(TOKEN_PLACEHOLDER)) {
    return template.replaceAll(TOKEN_PLACEHOLDER, encodeURIComponent(accessToken));
  }

  try {
    const url = new URL(template);
    url.searchParams.set("token", accessToken);
    return url.toString();
  } catch {
    return null;
  }
}
