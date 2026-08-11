import fs from "fs";
import path from "path";
import type { InstructorNote, InstructorNoteRepository } from "./instructorNoteRepository";

// 로컬(dev) 전용 저장소. .local/ 은 gitignore라 배포에 올라가지 않는다.
// 배포 저장은 PrismaInstructorNoteRepository가 담당한다.
const DATA_FILE = path.join(process.cwd(), ".local", "instructor-wiki.json");

function readAll(): Record<string, InstructorNote> {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Record<string, InstructorNote>;
  } catch {
    return {};
  }
}

export class LocalJsonInstructorNoteRepository implements InstructorNoteRepository {
  async getNote(name: string): Promise<InstructorNote> {
    return readAll()[name] ?? {};
  }

  async getAllNotes(): Promise<Record<string, InstructorNote>> {
    return readAll();
  }

  async saveNote(name: string, patch: InstructorNote): Promise<InstructorNote> {
    const all = readAll();
    const merged = { ...all[name], ...patch };
    all[name] = merged;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf-8");
    return merged;
  }
}
