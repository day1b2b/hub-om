import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { HubBotWidget } from "./HubBotWidget";

export async function HubBot() {
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !isAllowedWorkspaceEmail(email)) return null;

  return <HubBotWidget />;
}
