import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { requireSupplyApiSession } from "@/lib/auth/requireSupplySession";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { parseEggDeviceInput } from "@/lib/data/eggs/eggDeviceInput";
import { getEggRepository } from "@/lib/data/eggs/prismaEggRepository";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/**
 * 두 가지 요청을 받는다.
 * - { action: "exhaust", exhausted: boolean } : 데이터 소진 표시 켜고 끄기
 * - 그 밖의 본문 : 기기 정보 수정
 */
async function activityPATCH(request: Request, { params }: RouteContext) {
  const session = await requireSupplyApiSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "지금은 관리자만 사용할 수 있습니다." }, { status: 403 });
  }
  const actorName = session.user?.name || session.user?.email || "알 수 없음";
  const { id } = await params;
  const repository = getEggRepository();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const body = (raw ?? {}) as Record<string, unknown>;

  // 데이터 소진 표시는 일상 운영이라 로그인한 누구나 가능하다.
  if (body.action === "exhaust") {
    try {
      await repository.setDataExhausted(id, body.exhausted === true, actorName);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json(
        { ok: false, error: "데이터 소진 표시에 실패했습니다." },
        { status: 500 }
      );
    }
  }

  // 기기 정보 수정은 관리자(ADMIN_EMAILS)만 가능하다.
  try {
    await assertAdminSession();
  } catch {
    return NextResponse.json(
      { ok: false, error: "기기 정보 수정은 관리자만 할 수 있습니다." },
      { status: 403 }
    );
  }

  const parsed = parseEggDeviceInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const device = await repository.updateDevice(id, parsed.value);
    return NextResponse.json({ ok: true, device });
  } catch (error) {
    const duplicated = error instanceof Error && error.message.includes("Unique constraint");
    return NextResponse.json(
      { ok: false, error: duplicated ? "같은 번호의 에그가 이미 있습니다." : "기기 수정에 실패했습니다." },
      { status: duplicated ? 409 : 500 }
    );
  }
}

export const PATCH = withActivity("/api/eggs/devices/[id]", "PATCH", activityPATCH);
