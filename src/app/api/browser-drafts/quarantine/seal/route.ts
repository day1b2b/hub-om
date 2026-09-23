import { quarantinePost } from "@/lib/privacy/legacyDraftQuarantineHttp.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  return quarantinePost(request, "seal");
}
