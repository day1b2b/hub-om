import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addCustomTools, listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { createLinkedOperationForOmRequest } from "@/lib/data/omRequest/omRequestOperationLink";
import { getOmRequestRepository } from "@/lib/data/omRequest/omRequestRepositoryFactory";
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
    const omRequestRepository = getOmRequestRepository();
    const created = await omRequestRepository.createOmRequest(body);
    addCustomTools(extractUnknownTools(created.tools ?? "", listCustomTools()));

    // 운영현황에서 바로 확인/수정할 수 있도록 연결한다. 실패해도 요청 접수 자체는 막지 않는다.
    try {
      const operationId = await createLinkedOperationForOmRequest(created);
      if (operationId) {
        await omRequestRepository.setOmRequestOperationId(created.id, operationId);
        created.operationId = operationId;
      }
    } catch (linkError) {
      console.error("om-request → 운영현황 자동 연결 실패", linkError);
    }

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
