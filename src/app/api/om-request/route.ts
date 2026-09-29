import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addCustomTools, listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { createOmRequest, setOmRequestOperationId, setOmRequestSlackMeta } from "@/lib/data/omRequest/omRequestLocalRepository";
import { createLinkedOperationForOmRequest } from "@/lib/data/omRequest/omRequestOperationLink";
import type { OmRequestInput } from "@/lib/data/omRequest/omRequestTypes";
import { extractUnknownTools } from "@/lib/data/omRequest/omToolOptions";
import { getOmRequestRepository, getOmRequestNotifier } from "@/lib/data/omRequest/omRequestRepositoryFactory";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getOmCustomToolsRepository } from "@/lib/data/omRequest/omCustomToolsLocalRepository";

async function activityPOST(request: Request) {
  try {
    let ldEmail: string | undefined;
    if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
      ldEmail = process.env.DEV_AUTH_EMAIL ?? undefined;
    } else {
      const session = await auth();
      ldEmail = session?.user?.email ?? undefined;
    }
    // Missing scoped services are configuration failures, before the core save.
    getOmRequestRepository();
    getOperationRepository();
    getOmCustomToolsRepository();
    const notifier = getOmRequestNotifier();
    const body = (await request.json()) as OmRequestInput;
    // 핵심: 요청 저장. 이 단계가 실패하면 진짜 실패다.
    const created = await createOmRequest(body);

    // 이하는 부수 작업(운영현황 자동 연결·커스텀 툴 적재·Slack 알림·스레드 저장). 하나라도
    // 실패해도 이미 저장된 요청까지 실패로 되돌리면 안 되므로 각각 방어적으로 처리한다.
    // (예: 컨테이너 파일시스템 쓰기 불가 시 addCustomTools가 던지던 문제)
    try {
      const operationId = await createLinkedOperationForOmRequest(created);
      if (operationId) {
        const withOperationId = await setOmRequestOperationId(created.id, operationId);
        if (withOperationId) created.operationId = withOperationId.operationId;
      }
    } catch {
      console.error("[om-request] 운영현황 자동 연결 실패(무시):");
    }

    try {
      addCustomTools(extractUnknownTools(created.tools ?? "", listCustomTools()));
    } catch {
      console.error("[om-request] 커스텀 툴 저장 실패(무시):");
    }

    let slackThread: { channel: string; ts: string } | null = null;
    try {
      slackThread = await notifier.notifyCreated({
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
    } catch {
      console.error("[om-request] Slack 접수 알림 실패(무시):");
    }

    // 배정 시 같은 스레드에 댓글·LD 태깅을 하기 위해 스레드/이메일 저장
    let withMeta = created;
    try {
      withMeta =
        (await setOmRequestSlackMeta(created.id, {
          ldEmail,
          slackChannel: slackThread?.channel,
          slackThreadTs: slackThread?.ts,
        })) ?? created;
    } catch {
      console.error("[om-request] Slack 메타 저장 실패(무시):");
    }

    return NextResponse.json(withMeta, { status: 201 });
  } catch {
    console.error("[om-request] 요청 저장 실패:");
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

export const POST = withActivity("/api/om-request", "POST", activityPOST);
