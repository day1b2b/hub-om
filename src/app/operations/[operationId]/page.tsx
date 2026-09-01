import { notFound } from "next/navigation";
import { OperationDetail } from "@/features/operations/OperationDetail";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { LocalJsonOperationRepository } from "@/lib/data/localJsonOperationRepository";
import { isSameCourse, normalizeCourseId } from "@/lib/data/operationCalculations";
import { readOperationCollaboration } from "@/lib/data/operationCollaboration";
import { resolveOnsiteOmOptionsByEmail } from "@/lib/data/myOperations";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import { getInstructorNoteRepository } from "@/lib/data/instructorNoteRepositoryFactory";
import type { OperationSession } from "@/lib/data/operationTypes";
import { buildPersonOptions, buildRoleRosterFromOperations, mergeRoleRosters } from "@/lib/data/personOptions";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { filterOperationsByTeamScope, resolveTeamScope } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface OperationDetailPageProps {
  params: Promise<{
    operationId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OperationDetailPage({ params, searchParams }: OperationDetailPageProps) {
  const session = await requireWorkspaceSession();

  const { operationId } = await params;
  const repository = getOperationRepository();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [operations, ownerRoster, roleRoster, instructorNotes, queryParams] = await Promise.all([
    repository.listOperations(),
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
  const onsiteOmOptions = await resolveOnsiteOmOptionsByEmail(session.user?.email, personOptions.om);
  let operation = operations.find((candidate) => candidate.operationId === operationId);
  let allOperations = operations;

  if (!operation && isExcelImportOperationId(operationId)) {
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
  const collaboration = await readOperationCollaboration(operation);

  return (
    <OperationDetail
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
