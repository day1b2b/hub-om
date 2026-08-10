import fs from "fs";
import path from "path";
import type { OmAvailabilityRoster } from "./omAvailabilityTypes";

const DATA_FILE = path.join(process.cwd(), "om-availability.json");

function readRoster(): OmAvailabilityRoster {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as OmAvailabilityRoster;
  } catch {
    return {};
  }
}

export function getOmNamesForPart(part: string): string[] {
  return readRoster()[part] ?? [];
}

export function getOmAvailabilityRoster(): OmAvailabilityRoster {
  return readRoster();
}
