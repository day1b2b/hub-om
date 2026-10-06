import { CoachStatus } from "@prisma/client";
import { getPrismaClient } from "@/lib/data/prisma";

export interface PublicCoachTokenContext {
  id: string;
  sourceCoachId: string;
  name: string;
  workType: string | null;
  status: CoachStatus;
  accessToken: string;
}

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

  const prisma = getPrismaClient();
  const coach = await prisma.coach.findFirst({
    where: {
      accessToken: token,
      deletedAt: null
    },
    select: {
      id: true,
      sourceCoachId: true,
      name: true,
      workType: true,
      status: true,
      accessToken: true
    }
  });

  if (!coach?.accessToken) return null;

  return {
    ...coach,
    accessToken: coach.accessToken
  };
}
