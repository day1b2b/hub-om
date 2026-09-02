import { MyDashboard } from "@/features/dashboard/MyDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { diagnoseOmNameMismatch } from "@/features/dashboard/omNameDiagnosis";
import { filterOmRequestsByAssignee, filterOperationsByOm, resolveOmNameByEmail } from "@/lib/data/myOperations";
import { findTeamUsersByEmail } from "@/lib/data/teamUsers/teamUserRepository";
import { listOmRequests } from "@/lib/data/omRequest/omRequestLocalRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";

export const dynamic = "force-dynamic";

export default async function MyDashboardPage() {
  const session = await requireWorkspaceSession();
  const omName = await resolveOmNameByEmail(session.user?.email);

  if (!omName) {
    return <MyDashboard assignedRequests={[]} diagnosis={null} omName={null} operations={[]} />;
  }

  const repository = getOperationRepository();
  const operations = await repository.listOperations();
  const myOperations = filterOperationsByOm(operations, omName);
  const assignedRequests = filterOmRequestsByAssignee(await listOmRequests(), omName);

  // 담당이 0건이면 왜 0건인지 화면에서 읽을 수 있게 진단을 함께 넘긴다.
  // 이름 어긋남·이메일 중복이 "배정된 담당 과정이 없습니다"로 뭉개지던 문제.
  const rosterNamesForEmail = (await findTeamUsersByEmail(session.user?.email)).map((user) => user.name);
  const diagnosis = diagnoseOmNameMismatch({
    omName,
    matchedOperations: myOperations.length,
    matchedRequests: assignedRequests.length,
    operations,
    rosterNamesForEmail
  });

  return (
    <MyDashboard
      assignedRequests={assignedRequests}
      diagnosis={diagnosis}
      omName={omName}
      operations={myOperations}
    />
  );
}
