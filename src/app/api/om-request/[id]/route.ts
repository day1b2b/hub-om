import { NextResponse } from "next/server";
import { deleteOmRequest, updateOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import type { OmRequestInput } from "@/lib/data/omRequest/omRequestTypes";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json()) as OmRequestInput;
    const updated = updateOmRequest(id, body);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "수정 실패" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const deleted = deleteOmRequest(id);
    if (!deleted) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
