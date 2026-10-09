import { OperationDetail } from "@/features/operations/OperationDetail";
import { LocalJsonOperationRepository } from "@/lib/data/localJsonOperationRepository";
import { isSameCourse, normalizeCourseId } from "@/lib/data/operationCalculations";
import type { OperationSession } from "@/lib/data/operationTypes";
import type { OperationCollaboration } from "@/lib/data/operationCollaboration";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";

export const dynamic = "force-dynamic";

const collaboration: OperationCollaboration = {
  changeHistory: [], changeHistoryStatus: "disabled", discussionDiagnostics: { emailCandidateCount: 0, emailMatchedCount: 0 },
  discussionEmailCandidates: [], discussionIssues: [], discussionReferences: [], discussionSourceAvailability: { emailEnabled: false, slackEnabled: false },
  discussionStatus: "disabled", lectureReports: [], lectureReportStatus: "disabled"
};

function syntheticOperations(source: OperationSession): OperationSession[] {
  const base = { ...source, id: "preview-1", operationId: "preview-op-1", courseRecordId: "preview-course", courseId: "PREVIEW", courseIdLabel: "미리보기", companyName: "합성 기업", courseName: "공통 메모 화면 미리보기", courseCategory: "AI", om: "합성 운영자", ld: "합성 담당자", specialNotes: "공통으로 확인할 회차 메모", operationIssue: "", omUpdate: "", courseCommonNote: undefined };
  return [base, { ...base, id: "preview-2", operationId: "preview-op-2", roundNo: "2", specialNotes: "두 번째 회차에서 확인할 메모" }];
}

export default async function PreviewOperationDetailPage() {
  const operations = await new LocalJsonOperationRepository().listOperations();
  const source = operations[0];
  if (!source) return <p>미리보기용 로컬 데이터가 없습니다.</p>;
  const preview = syntheticOperations(source);
  const operation = preview[0];
  return <OperationDetail collaboration={collaboration} extraTools={listCustomTools()} operation={operation} relatedOperations={preview} sameCourseIdOperations={preview} teamScope="both" />;
}
