import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { getDeletedOperationRepository } from "@/lib/data/deletedOperationRepositoryFactory";
import { runAdminMaintenanceRequest } from "@/lib/data/adminMaintenanceComposition";

export const dynamic = "force-dynamic";

async function activityGET() {
  await assertAdminSession();

  const operations = await getDeletedOperationRepository().listDeletedOperations();

  return NextResponse.json({
    ok: true,
    operations
  });
}

async function activityPUT(request: Request) {
  await assertAdminSession();

  const body = (await request.json().catch(() => ({}))) as { operationId?: unknown };
  if (typeof body.operationId !== "string") {
    return NextResponse.json({ ok: false, error: "운영 차수 ID가 필요합니다." }, { status: 400 });
  }

  const session = await getDeletedOperationRepository().restoreOperation(body.operationId);

  return NextResponse.json({ ok: true, operation: session });
}

export const GET = withActivity("/api/admin/deleted-operations", "GET", activityGET, runAdminMaintenanceRequest);

export const PUT = withActivity("/api/admin/deleted-operations", "PUT", activityPUT, runAdminMaintenanceRequest);
