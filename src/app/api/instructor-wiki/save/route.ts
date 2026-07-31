import { NextResponse } from "next/server";
import { saveInstructorNote, type InstructorNote } from "@/lib/data/instructorWikiStore";

// 강사위키 OM 입력값 저장. 강사명 기준으로 부분 병합.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string } & InstructorNote;
    const { name, ...patch } = body;
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name 필요" }, { status: 400 });
    }
    const saved = saveInstructorNote(name, patch);
    return NextResponse.json({ ok: true, saved });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
