import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import type { OmRequestInput } from "@/lib/data/omRequest/omRequestTypes";
import { notifyOmRequestSubmitted } from "@/lib/slack/postOmRequestSlackNotification";

function getDevBypassEmail(): string | undefined {
  if (process.env.DEV_AUTH_BYPASS !== "true" || process.env.NODE_ENV === "production") return undefined;
  return process.env.DEV_AUTH_EMAIL ?? "dev@day1company.co.kr";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OmRequestInput;
    const created = createOmRequest(body);

    const session = await auth();
    const submitterEmail = session?.user?.email ?? getDevBypassEmail();
    void notifyOmRequestSubmitted(created, submitterEmail);

    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
