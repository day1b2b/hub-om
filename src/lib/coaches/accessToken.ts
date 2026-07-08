import { randomBytes } from "node:crypto";

export function generateCoachAccessToken(): string {
  return randomBytes(32).toString("hex");
}

export function normalizeCoachName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
