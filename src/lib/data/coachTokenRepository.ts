import type { CoachStatus } from "@prisma/client";

/** Internal authenticated context. Never serialize this object as the public response. */
export interface PublicCoachTokenContext {
  id: string;
  sourceCoachId: string;
  name: string;
  workType: string | null;
  status: CoachStatus;
  accessToken: string;
}
export interface CoachOwnProfile {
  id: string;
  name: string;
  status: string;
  workType: string | null;
  availabilityDetail: string | null;
  fields: { id: string; name: string }[];
  curriculums: { id: string; name: string }[];
}
export interface CoachTokenRepository {
  findByToken(token: string): Promise<PublicCoachTokenContext | null>;
  /** Resolves the token again inside the profile read, never trusts a caller-provided coach id. */
  getOwnProfile(token: string): Promise<CoachOwnProfile | null>;
}
