import { NextResponse } from "next/server";
import { addCustomTools, listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { getOmRequestRepository } from "@/lib/data/omRequest/omRequestRepositoryFactory";
import type { OmRequestInput } from "@/lib/data/omRequest/omRequestTypes";
import { extractUnknownTools } from "@/lib/data/omRequest/omToolOptions";

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Props) {
  try {
    const { id } = await params;
    const body = (await request.json()) as OmRequestInput;
    const updated = await getOmRequestRepository().updateOmRequest(id, body);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    addCustomTools(extractUnknownTools(updated.tools ?? "", listCustomTools()));
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Props) {
  try {
    const { id } = await params;
    const ok = await getOmRequestRepository().deleteOmRequest(id);
    if (!ok) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
