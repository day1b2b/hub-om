import { assertCoachPiiAccess } from "@/lib/auth/requireAdminSession";

export async function requireCoachSyncAccess(request: Request): Promise<string> {
  const configuredSecret = process.env.SYNC_API_SECRET;
  const authorization = request.headers.get("authorization");

  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) {
    return "sync-api-secret";
  }

  const session = await assertCoachPiiAccess();
  return session.user?.email ?? "admin-session";
}
