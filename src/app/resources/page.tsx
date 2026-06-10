import { ResourceJudgmentPage } from "@/features/resources/ResourceJudgmentPage";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  await requireWorkspaceSession();

  const repository = getOperationRepository();
  const teamMemberRepository = getTeamMemberRepository();
  const [operations, ownerRoster] = await Promise.all([
    repository.listOperations(),
    teamMemberRepository.listResourceOwners()
  ]);

  return <ResourceJudgmentPage operations={operations} ownerRoster={ownerRoster} />;
}
