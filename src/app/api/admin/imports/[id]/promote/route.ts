import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { promoteReadyImportRows } from "@/lib/data/importPromotionService";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  await requireWorkspaceSession();

  const { id } = await params;

  try {
    const result = await promoteReadyImportRows(id);

    revalidatePath("/");
    revalidatePath("/operations");
    revalidatePath("/admin/imports");
    revalidatePath(`/admin/imports/${id}`);

    return NextResponse.json({
      ok: true,
      result
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "반영하지 못했습니다." },
      { status: 400 }
    );
  }
}
