import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { readSourceStatuses } from "@/lib/sourceReads";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.user?.email || !isAllowedWorkspaceEmail(session.user.email)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sources = await readSourceStatuses();

  return NextResponse.json({
    ok: sources.every((source) => source.status !== "failed"),
    sources
  });
}
