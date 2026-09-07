import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
export const dynamic = "force-dynamic";
export default async function ActivityPage() { await requireAdminSession(); redirect("/usage"); }
