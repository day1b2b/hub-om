import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import { hasOmRequestAssignmentOverride, omRequestManagerName } from "@/lib/data/omRequest/omRequestTypes";
import { isAllowedWorkspaceEmail } from "./workspaceAccess";

function canonicalEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+$/.test(email) && isAllowedWorkspaceEmail(email) ? email : null;
}

/**
 * 호출자는 인증된 세션 이메일만 전달한다. Google 표시 이름은 권한 근거로 쓰지 않는다.
 * 기존 파트 관리자 이름을 관리자만 편집 가능한 명단의 유일한 계정으로 연결한다.
 * 명단 누락·중복·조회 실패는 권한을 추정하지 않고 닫는다.
 */
export async function canManageOmRequestAssignment(team: string, sessionEmail?: string | null): Promise<boolean> {
  const managerName = omRequestManagerName(team);
  const email = canonicalEmail(sessionEmail);
  if (!managerName || !email) return false;
  if (hasOmRequestAssignmentOverride(email)) return true;

  try {
    const users = await listTeamUsers();
    const managers = users.filter((user) => user.name.trim() === managerName);
    if (managers.length !== 1) return false;
    const managerEmail = canonicalEmail(managers[0].email);
    if (!managerEmail || managerEmail !== email) return false;
    return users.filter((user) => canonicalEmail(user.email) === managerEmail).length === 1;
  } catch {
    return false;
  }
}
