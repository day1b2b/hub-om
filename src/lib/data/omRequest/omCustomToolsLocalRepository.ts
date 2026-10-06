import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "om-custom-tools.json");

function readAll(): string[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as string[];
  } catch {
    return [];
  }
}

export function listCustomTools(): string[] {
  return readAll();
}

// 누군가 "기타" 직접입력으로 새 도구를 적으면 여기에 쌓여서, 이후 사람들은 체크박스로 바로 고를 수 있게 된다.
export function addCustomTools(names: string[]): void {
  if (names.length === 0) return;
  const merged = new Set([...readAll(), ...names]);
  fs.writeFileSync(DATA_FILE, JSON.stringify(Array.from(merged).sort((a, b) => a.localeCompare(b, "ko")), null, 2), "utf-8");
}
