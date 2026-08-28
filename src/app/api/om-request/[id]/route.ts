import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/auth/requireAdminSession";
import { addCustomTools, listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { deleteOmRequest, getOmRequest, updateOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import { isOmRequestAuthor, type OmRequestInput } from "@/lib/data/omRequest/omRequestTypes";
import { extractUnknownTools } from "@/lib/data/omRequest/omToolOptions";

interface Props {
  params: Promise<{ id: string }>;
}

async function resolveRequestEmail(): Promise<string | undefined> {
  if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return process.env.DEV_AUTH_EMAIL ?? undefined;
  }
  const session = await auth();
  return session?.user?.email ?? undefined;
}

export async function PATCH(request: Request, { params }: Props) {
  try {
    const { id } = await params;
    const existing = await getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    const email = await resolveRequestEmail();
    if (!isAdminEmail(email) && !isOmRequestAuthor(existing, email)) {
      return NextResponse.json({ error: "본인이 작성한 요청만 수정할 수 있습니다." }, { status: 403 });
    }

    const body = (await request.json()) as OmRequestInput;
    const updated = await updateOmRequest(id, body);
    if (!updated) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    try {
      addCustomTools(extractUnknownTools(updated.tools ?? "", listCustomTools()));
    } catch (err) {
      console.error("[om-request] 커스텀 툴 저장 실패(무시):", err);
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Props) {
  try {
    const { id } = await params;
    const existing = await getOmRequest(id);
    if (!existing) return NextResponse.json({ error: "요청 없음" }, { status: 404 });

    if (existing.status === "배정완료") {
      const email = await resolveRequestEmail();
      if (!isAdminEmail(email)) {
        return NextResponse.json({ error: "OM 지정 완료된 요청은 관리자만 삭제할 수 있습니다." }, { status: 403 });
      }
    }

    const ok = await deleteOmRequest(id);
    if (!ok) return NextResponse.json({ error: "요청 없음" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
