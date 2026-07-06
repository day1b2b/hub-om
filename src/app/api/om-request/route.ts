import { NextResponse } from "next/server";
import { createOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import type { OmRequestInput } from "@/lib/data/omRequest/omRequestTypes";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OmRequestInput;
    const created = createOmRequest(body);
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
