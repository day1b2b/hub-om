import { withActivity } from "@/lib/activity/request";
import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/requireAdminSession";
import { parseEggDeviceInput } from "@/lib/data/eggs/eggDeviceInput";
import { getEggRepository } from "@/lib/data/eggs/prismaEggRepository";

export const dynamic = "force-dynamic";

/** 기기 등록은 관리자(ADMIN_EMAILS)만 가능. WiFi 비밀번호 등 내부 정보를 이 화면으로 입력한다. */
async function activityPOST(request: Request) {
  try {
    await assertAdminSession();
  } catch {
    return NextResponse.json(
      { ok: false, error: "기기 등록은 관리자만 할 수 있습니다." },
      { status: 403 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const parsed = parseEggDeviceInput(raw);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const device = await getEggRepository().createDevice(parsed.value);
    return NextResponse.json({ ok: true, device }, { status: 201 });
  } catch (error) {
    const duplicated = error instanceof Error && error.message.includes("Unique constraint");
    return NextResponse.json(
      { ok: false, error: duplicated ? "같은 번호의 에그가 이미 있습니다." : "기기 등록에 실패했습니다." },
      { status: duplicated ? 409 : 500 }
    );
  }
}

export const POST = withActivity("/api/eggs/devices", "POST", activityPOST);
