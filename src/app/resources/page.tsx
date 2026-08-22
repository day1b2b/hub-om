import { ResourceJudgmentPage } from "@/features/resources/ResourceJudgmentPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOmAvailabilityRoster } from "@/lib/data/omAvailability/omAvailabilityLocalRepository";
import { listOmRequests } from "@/lib/data/omRequest/omRequestLocalRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import type { ResourceOwnerRoster } from "@/lib/data/teamMemberRepository";
import { getOperationSourceReader, type CalendarResourceEvent } from "@/lib/sourceReads";
import { filterOperationsByTeamScope, filterOwnerRosterByTeamScope, mergeUnclassified, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface ResourcesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResourcesPage({ searchParams }: ResourcesPageProps) {
  const session = await requireWorkspaceSession();

  const repository = getOperationRepository();
  const teamMemberRepository = getTeamMemberRepository();
  const [operations, memberRoster, roleRoster, calendarEvents, omRequests, params, partRoster] =
    await Promise.all([
      repository.listOperations(),
      teamMemberRepository.listResourceOwners(),
      teamMemberRepository.listRoleRosters(),
      listCalendarResourceEvents(),
      listOmRequests(),
      searchParams,
      getOmAvailabilityRoster()
    ]);
  const resourceOwnerRoster = roleRoster.om;
  const teamScope = resolveTeamScope(params, session, hasRosterMembers(memberRoster) ? memberRoster : resourceOwnerRoster);
  const scopedOperations = filterOperationsByTeamScope(operations, teamScope, resourceOwnerRoster);
  // 팀 스코프(1팀/2팀)는 멤버 관리의 "AX N파트" 표기를 모르므로, 그쪽 담당자는 필터에서
  // 전부 "미분류"로 떨어진다. 파트 필터/담당자 매칭이 그 사람들을 계속 인식하도록 되살린다.
  const scopedOwnerRoster = mergeUnclassified(filterOwnerRosterByTeamScope(resourceOwnerRoster, teamScope), resourceOwnerRoster);
  const scopedCalendarEvents = filterCalendarEventsByOwnerRoster(calendarEvents, scopedOwnerRoster);
  // om-request는 접수 시점에 바로 operation이 생성되므로(omRequestOperationLink), 정상적으로 연결된
  // 건은 이미 resourceOperations에 들어 있다. 연결이 실패한 예외 건만 캘린더에 별도로 보여준다.
  const pendingOmRequests = omRequests.filter((request) => !!request.assignedOm && !request.operationId);
  const teamLabel = teamScope === "team_1" ? "1팀" : teamScope === "team_2" ? "2팀" : null;
  const scopedPendingOmRequests = teamLabel
    ? pendingOmRequests.filter((request) => request.team === teamLabel)
    : pendingOmRequests;

  return (
    <ResourceJudgmentPage
      calendarEvents={scopedCalendarEvents}
      operations={scopedOperations}
      ownerRoster={scopedOwnerRoster}
      partRoster={partRoster}
      pendingOmRequests={scopedPendingOmRequests}
      teamScope={teamScope}
    />
  );
}

async function listCalendarResourceEvents(): Promise<CalendarResourceEvent[]> {
  try {
    const reader = await getOperationSourceReader();
    const result = await reader.readCalendarEvents();

    if (result.status === "failed") {
      return [];
    }

    return result.items;
  } catch {
    return [];
  }
}

function hasRosterMembers(roster: ResourceOwnerRoster) {
  return Object.values(roster).some((owners) => (owners ?? []).length > 0);
}

function filterCalendarEventsByOwnerRoster(events: CalendarResourceEvent[], ownerRoster: ResourceOwnerRoster) {
  const ownerNames = new Set(
    Object.values(ownerRoster)
      .flatMap((owners) => owners ?? [])
      .map(normalizeOwnerName)
  );

  if (ownerNames.size === 0) {
    return [];
  }

  return events.filter((event) => ownerNames.has(normalizeOwnerName(event.ownerName)));
}

function normalizeOwnerName(value: string) {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
