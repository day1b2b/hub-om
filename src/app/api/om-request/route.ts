import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addCustomTools, listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { createOmRequest, setOmRequestSlackMeta } from "@/lib/data/omRequest/omRequestLocalRepository";
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
    const created = await createOmRequest(body);
    addCustomTools(extractUnknownTools(created.tools ?? "", listCustomTools()));
    const slackThread = await notifyOmRequestCreated({
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
    // 배정 시 같은 스레드에 댓글·LD 태깅을 하기 위해 스레드/이메일 저장
    const withMeta =
      (await setOmRequestSlackMeta(created.id, {
        ldEmail,
        slackChannel: slackThread?.channel,
        slackThreadTs: slackThread?.ts,
      })) ?? created;
    return NextResponse.json(withMeta, { status: 201 });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
