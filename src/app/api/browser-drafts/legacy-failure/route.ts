import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { LEGACY_DRAFT_FAILURE_REASONS, notifyLegacyDraftFailure, type LegacyDraftFailureReason } from "@/lib/privacy/legacyDraftFailureAlert.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 사유 코드만 받는다. 초안 내용·키는 받지 않는다. */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isAllowedWorkspaceEmail(email)) return Response.json({ ok: false }, { status: 401 });
  const body = await request.json().catch(() => null) as { reason?: unknown } | null;
  const reason = body?.reason;
  if (typeof reason !== "string" || !Object.hasOwn(LEGACY_DRAFT_FAILURE_REASONS, reason)) return Response.json({ ok: false }, { status: 400 });
  await notifyLegacyDraftFailure(reason as LegacyDraftFailureReason, email);
  return Response.json({ ok: true });
}
