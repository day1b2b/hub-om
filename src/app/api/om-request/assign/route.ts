import { NextResponse } from "next/server";
import { updateOmRequestAssignment } from "@/lib/data/omRequest/omRequestLocalRepository";

export async function PATCH(request: Request) {
  try {
    const { id, assignedOm } = (await request.json()) as { id: string; assignedOm: string | null };
    if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
    const updated = updateOmRequestAssignment(id, assignedOm);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
