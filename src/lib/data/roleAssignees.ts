import { splitPersonNames } from "./personNames";
import type { ResourceOwnerRoster, TeamMemberRole, TeamMemberRoleRoster } from "./teamMemberRepository";

const ROLE_ALIASES: Record<TeamMemberRole, Record<string, string>> = {
  ld: {},
  om: {
    "이유진": "이유진C"
  }
};

export function roleNamesFromRoster(roster: TeamMemberRoleRoster, role: TeamMemberRole): string[] {
  return flattenRoster(roster[role]);
}

export function normalizeRoleAssigneeText(value: string, role: TeamMemberRole, roster: TeamMemberRoleRoster): string {
  return normalizeAssigneeNames(value, roleNamesFromRoster(roster, role), ROLE_ALIASES[role]);
}

export function findUnknownRoleAssigneeNames(value: string, role: TeamMemberRole, roster: TeamMemberRoleRoster): string[] {
  return findUnknownAssigneeNames(value, roleNamesFromRoster(roster, role), ROLE_ALIASES[role]);
}

export function findUnknownAssigneeNames(
  value: string,
  allowedNames: string[],
  aliases: Record<string, string> = {}
): string[] {
  const allowedMap = buildAllowedNameMap(allowedNames, aliases);
  const unknownNames: string[] = [];

  for (const rawName of splitPersonNames(value, "")) {
    if (!rawName) continue;

    if (!allowedMap.has(normalizePersonKey(rawName))) {
      unknownNames.push(rawName);
    }
  }

  return unknownNames;
}

export function normalizeAssigneeNames(
  value: string,
  allowedNames: string[],
  aliases: Record<string, string> = {}
): string {
  const allowedMap = buildAllowedNameMap(allowedNames, aliases);
  const names: string[] = [];

  for (const rawName of splitPersonNames(value, "")) {
    const normalizedName = normalizePersonKey(rawName);
    const matchedName = allowedMap.get(normalizedName);

    if (matchedName && !names.includes(matchedName)) {
      names.push(matchedName);
    }
  }

  return names.join(", ");
}

export function displayRoleAssigneeText(value: string, fallback: string): string {
  const names = splitPersonNames(value, "").map((name) => name.trim()).filter(Boolean);

  return names.length > 0 ? names.join(" / ") : fallback;
}

export function normalizePersonKey(value: string): string {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function flattenRoster(roster: ResourceOwnerRoster): string[] {
  return Object.values(roster)
    .flatMap((owners) => owners ?? [])
    .map((name) => name.trim())
    .filter(Boolean);
}

function buildAllowedNameMap(allowedNames: string[], aliases: Record<string, string>) {
  const allowedMap = new Map<string, string>();

  for (const name of allowedNames) {
    allowedMap.set(normalizePersonKey(name), name);
  }

  for (const [alias, canonicalName] of Object.entries(aliases)) {
    if (allowedNames.includes(canonicalName)) {
      allowedMap.set(normalizePersonKey(alias), canonicalName);
    }
  }

  return allowedMap;
}
