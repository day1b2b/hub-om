import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addCustomTools, listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { createOmRequest, setOmRequestSlackThread } from "@/lib/data/omRequest/omRequestLocalRepository";
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
    // 요청자(LD) 이메일은 폼 값이 아니라 로그인 세션 기준으로 저장(배정 알림 태깅에 사용).
    const created = createOmRequest({ ...body, ldEmail });
    addCustomTools(extractUnknownTools(created.tools ?? "", listCustomTools()));
    const posted = await notifyOmRequestCreated({
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
    // 배정 시 같은 스레드에 댓글을 달 수 있도록 알림 스레드 정보를 저장.
    if (posted) setOmRequestSlackThread(created.id, posted.channel, posted.ts);
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
