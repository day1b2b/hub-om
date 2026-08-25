import fs from "fs";
import path from "path";
import type { InstructorNote, InstructorNoteRepository } from "./instructorNoteRepository";

// 로컬(dev) 전용 저장소. .local/ 은 gitignore라 배포에 올라가지 않는다.
// 배포 저장은 PrismaInstructorNoteRepository가 담당한다.
//
// 파일 키 규칙: 노션 강사는 NO(예: "185"), 노션에 없는 강사는 이름.
// 예전에는 전부 이름을 키로 썼는데, 그러면 동명이인(김준범 NO=185 / NO=746)이 한 칸을 공유해
// 한쪽이 덮여 사라졌다. 배포(Prisma)는 notion_no가 unique 키라 둘 다 남으므로 로컬도 맞춘다.
// 예전 형식(이름 키)도 그대로 읽힌다. 값 안에 instructorName이 있어 표시에는 문제가 없다.
const DATA_FILE = path.join(process.cwd(), ".local", "instructor-wiki.json");

function readAll(): Record<string, InstructorNote> {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Record<string, InstructorNote>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, InstructorNote>): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf-8");
}

/** 파일 키가 이름이던 예전 데이터를 위해, 값에 이름이 없으면 키로 채워 준다. */
function withName(key: string, note: InstructorNote): InstructorNote {
  if (note.instructorName) return note;
  // 키가 NO(숫자)면 이름을 알 수 없으므로 비워 둔다. 화면은 instructorName을 본다.
  return /^\d+$/.test(key) ? note : { ...note, instructorName: key };
}

function storageKey(note: InstructorNote, fallback: string): string {
  return note.notionNo !== undefined ? String(note.notionNo) : fallback;
}

export class LocalJsonInstructorNoteRepository implements InstructorNoteRepository {
  async getNote(name: string): Promise<InstructorNote> {
    const all = readAll();
    const entries = Object.entries(all).map(([key, note]) => withName(key, note));
    const matches = entries.filter((note) => (note.instructorName ?? "").trim() === name);
    if (matches.length === 0) return {};
    // 여러 행이면 NO 없는 행(운영현황 표기)을 먼저 본다. Prisma 구현과 같은 규칙.
    return matches.find((note) => note.notionNo === undefined) ?? matches[0];
  }

  async getNoteByNotionNo(notionNo: number): Promise<InstructorNote> {
    const all = readAll();
    const direct = all[String(notionNo)];
    if (direct) return withName(String(notionNo), direct);
    // 예전 형식(이름 키)에서도 찾는다.
    for (const [key, note] of Object.entries(all)) {
      if (note?.notionNo === notionNo) return withName(key, note);
    }
    return {};
  }

  async listNotes(): Promise<InstructorNote[]> {
    return Object.entries(readAll()).map(([key, note]) => withName(key, note));
  }

  async saveNote(name: string, patch: InstructorNote): Promise<InstructorNote> {
    const all = readAll();
    // 이 이름의 기존 행을 찾는다(NO 키로 저장돼 있을 수도 있다).
    const foundKey = Object.keys(all).find(
      (key) => (withName(key, all[key]).instructorName ?? "").trim() === name
    );
    const base = foundKey ? all[foundKey] : undefined;
    const merged: InstructorNote = { ...base, ...patch, instructorName: name };
    const nextKey = storageKey(merged, name);

    if (foundKey && foundKey !== nextKey) delete all[foundKey];
    all[nextKey] = merged;
    writeAll(all);
    return merged;
  }

  async saveNoteByNotionNo(notionNo: number, patch: InstructorNote): Promise<InstructorNote> {
    const all = readAll();
    const key = String(notionNo);
    // 예전 형식(이름 키)으로 있던 같은 NO 행을 찾아 옮긴다.
    const legacyKey = Object.keys(all).find((k) => k !== key && all[k]?.notionNo === notionNo);
    // NO가 아직 없던 이름 키 행도 이어 붙인다(첫 동기화가 스스로 backfill).
    const byNameKey =
      legacyKey || all[key]
        ? undefined
        : Object.keys(all).find(
            (k) => all[k]?.notionNo === undefined && (withName(k, all[k]).instructorName ?? "").trim() === patch.instructorName?.trim()
          );

    const previousKey = legacyKey ?? byNameKey;
    const base = all[key] ?? (previousKey ? all[previousKey] : undefined);
    const merged: InstructorNote = { ...base, ...patch, notionNo };

    if (previousKey) delete all[previousKey];
    all[key] = merged;
    writeAll(all);
    return merged;
  }
}
