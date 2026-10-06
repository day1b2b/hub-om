import { getCoachTokenRepository } from "@/lib/data/coachTokenRepositoryFactory";
import type { PublicCoachTokenContext } from "@/lib/data/coachTokenRepository";
export type { PublicCoachTokenContext } from "@/lib/data/coachTokenRepository";

export function extractCoachToken(request: Request): string | null {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token")?.trim();
  if (queryToken) return queryToken;

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const headerToken = authorization.slice("Bearer ".length).trim();
  return headerToken || null;
}

export async function validateCoachToken(token: string | null): Promise<PublicCoachTokenContext | null> {
  if (!token) return null;
  return getCoachTokenRepository().findByToken(token);
}
