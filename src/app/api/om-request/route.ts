import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addCustomTools, listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { createOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import type { OmRequestInput } from "@/lib/data/omRequest/omRequestTypes";
import { extractUnknownTools } from "@/lib/data/omRequest/omToolOptions";
import { notifyOmRequestCreated } from "@/lib/slack/notifySlack";

export async function POST(request: Request) {
  try {
    let ldEmail: string | undefined;
    if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
      ldEmail = process.env.DEV_AUTH_EMAIL ?? undefined;
    } else {
      const session = await auth();
      ldEmail = session?.user?.email ?? undefined;
    }
    const body = (await request.json()) as OmRequestInput;
    const created = createOmRequest(body);
    addCustomTools(extractUnknownTools(created.tools ?? "", listCustomTools()));
    await notifyOmRequestCreated({
      team: created.team,
      ld: created.ld,
      ldEmail,
      company: created.company,
      trainingType: created.trainingType,
      courseName: created.courseName,
      syncupLink: created.syncupLink,
      skillfloSetup: created.skillfloSetup,
      onSiteOperation: created.onSiteOperation,
      coachRequest: created.coachRequest,
      totalSessions: created.totalSessions,
      sessions: created.sessions,
      notes: created.notes,
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
