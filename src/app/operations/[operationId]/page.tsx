import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { LocalJsonOperationRepository } from "@/lib/data/localJsonOperationRepository";
import { isSameCourse, normalizeCourseId } from "@/lib/data/operationCalculations";
import type { OperationCollaboration } from "@/lib/data/operationCollaboration";
import { resolveOnsiteOmOptionsByEmail } from "@/lib/data/myOperations";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { listOperationsCached } from "@/lib/data/operationListCache";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getInstructorNoteRepository } from "@/lib/data/instructorNoteRepositoryFactory";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import type { OperationSession } from "@/lib/data/operationTypes";
import { buildPersonOptions, buildRoleRosterFromOperations, mergeRoleRosters } from "@/lib/data/personOptions";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { filterOperationsByTeamScope, resolveTeamScope } from "@/lib/teamScope";
import { allowsLegacyOperationPageFallback, runOperationPagesRequest } from "@/lib/data/operationPagesComposition";

export const dynamic = "force-dynamic";

/**
 * OperationDetail의 SHOW_OPERATION_DISCUSSION/SHOW_LECTURE_REPORTS가 둘 다 꺼져 있어
 * (src/features/operations/OperationDetail.tsx) 화면에서 전혀 쓰이지 않는다. 그런데도
 * readOperationCollaboration()을 부르면 매 상세 페이지 진입마다 Slack/메일을 실제로
 * 읽어와서 느려지기만 했다. 두 플래그를 다시 켜면 이 자리를 readOperationCollaboration(operation)
 * 호출로 되돌려야 한다.
 */
const DISABLED_COLLABORATION: OperationCollaboration = {
  changeHistory: [],
  changeHistoryStatus: "disabled",
  discussionDiagnostics: { emailCandidateCount: 0, emailMatchedCount: 0 },
  discussionEmailCandidates: [],
  discussionIssues: [],
  discussionReferences: [],
  discussionSourceAvailability: { emailEnabled: false, slackEnabled: false },
  discussionStatus: "disabled",
  lectureReports: [],
  lectureReportStatus: "disabled"
};

interface OperationDetailPageProps {
  params: Promise<{
    operationId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OperationDetailPage({ params, searchParams }: OperationDetailPageProps) {
  return runOperationPagesRequest(() => renderOperationDetailPage({ params, searchParams }));
}

async function renderOperationDetailPage({ params, searchParams }: OperationDetailPageProps) {
  const session = await requireWorkspaceSession();

  const { operationId } = await params;
  const repository = getOperationRepository();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [operations, ownerRoster, roleRoster, instructorNotes, queryParams] = await Promise.all([
    listOperationsCached(repository),
    teamMemberRepository.listResourceOwners(),
    teamMemberRepository.listRoleRosters(),
    getInstructorNoteRepository().listNotes(),
    searchParams
  ]);
  const personOptions = buildPersonOptions(mergeRoleRosters(roleRoster, buildRoleRosterFromOperations(operations)));
  // 강사 드롭다운 추천용. 노션 강사 DB(InstructorNote) 동기화 명단에서 가져온다.
  // 목록에 없으면 자유 입력 그대로 저장된다(신규 강사 등, 선택을 강제하지 않음).
  const instructorOptions = Array.from(
    new Set(instructorNotes.map((n) => (n.displayName || n.instructorName || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "ko"));
  // 실습코치 드롭다운 추천용. coach-db(노션 실습코치 DB 동기화) 명단에서 가져온다.
  // 로컬 dev 등 DB 미연결이면 조용히 생략(자유 입력 그대로 저장된다).
  // listCoaches/onsiteOmOptions는 서로 의존하지 않으므로 병렬로 가져온다.
  const coachOptionsPromise = getCoachRepository()
    .listCoaches()
    .then((coaches) =>
      Array.from(new Set(coaches.map((coach) => coach.name.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "ko")
      )
    )
    .catch(() => [] as string[]);
  const onsiteOmOptionsPromise = resolveOnsiteOmOptionsByEmail(session.user?.email, personOptions.om);

  let operation = operations.find((candidate) => candidate.operationId === operationId);
  let allOperations = operations;

  if (!operation && isExcelImportOperationId(operationId) && allowsLegacyOperationPageFallback()) {
    const localOperations = await new LocalJsonOperationRepository().listOperations();
    operation = localOperations.find((candidate) => candidate.operationId === operationId);
    allOperations = mergeOperationLists(allOperations, localOperations);
  }

  const teamScope = resolveTeamScope(queryParams, session, ownerRoster);

  if (!operation) {
    notFound();
  }

  const scopedOperations = filterOperationsByTeamScope(allOperations, teamScope, ownerRoster);
  const relatedOperations = scopedOperations.filter((candidate) => isSameCourse(candidate, operation));
  const sameCourseIdOperations = operation.courseId
    ? scopedOperations.filter(
        (candidate) => normalizeCourseId(candidate.courseId) === normalizeCourseId(operation.courseId)
      )
    : [];

  const [coachOptions, onsiteOmOptions] = await Promise.all([coachOptionsPromise, onsiteOmOptionsPromise]);
  const collaboration = DISABLED_COLLABORATION;

  return (
    <OperationDetail
      coachOptions={coachOptions}
      collaboration={collaboration}
      extraTools={listCustomTools()}
      instructorOptions={instructorOptions}
      onsiteOmOptions={onsiteOmOptions}
      operation={operation}
      personOptions={personOptions}
      relatedOperations={relatedOperations}
      sameCourseIdOperations={sameCourseIdOperations}
      teamScope={teamScope}
    />
  );
}

function isExcelImportOperationId(operationId: string) {
  return operationId.startsWith("excel-");
}

function mergeOperationLists(...operationLists: OperationSession[][]) {
  const operations = new Map<string, OperationSession>();

  for (const operationList of operationLists) {
    for (const operation of operationList) {
      operations.set(operation.operationId, operation);
    }
  }

  return [...operations.values()];
}
