import { MyDashboard } from "@/features/dashboard/MyDashboard";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { diagnoseOmNameMismatch } from "@/features/dashboard/omNameDiagnosis";
import { dropRequestsWithDeletedOperation } from "@/features/dashboard/orphanRequests";
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
  // 운영 현황에서 지워진 과정의 요청은 걷어낸다. 요청은 운영을 지워도 남아서,
  // 운영 현황에는 없는 과정이 내 대시보드에만 떠 있었다. 여기서 한 번 걸러 두면
  // 표·캘린더·사전세팅·D-day·요약이 한꺼번에 같은 기준을 쓴다.
  // 살아있는 운영은 전체 목록으로 본다 — 내 담당이 아닌 운영과 짝인 요청도 있을 수 있다.
  const assignedRequests = dropRequestsWithDeletedOperation(
    filterOmRequestsByAssignee(await listOmRequests(), omName),
    operations
  );

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
