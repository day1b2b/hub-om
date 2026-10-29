import { storedEvaluationAverage } from "@/lib/coaches/coachEvaluationRules";
import { getCoachEvaluationRepository } from "@/lib/data/coachEvaluationRepositoryFactory";

/**
 * 새 OM 평가의 투입별 평균(투입 ID → 평균). 코치 위키 목록·상세가 같이 쓴다.
 * 평가 저장소를 못 열면 비워 두고 예전 평점으로 보여준다.
 */
export async function loadEvaluationAverages(): Promise<Map<string, number>> {
  const averages = new Map<string, number>();
  try {
    for (const input of await getCoachEvaluationRepository().listOmAverageInputs()) {
      const average = storedEvaluationAverage(input.scores);
      if (input.engagementId && average !== null) averages.set(input.engagementId, average);
    }
  } catch {
    console.error("[coaches] evaluation averages unavailable");
    averages.clear();
  }
  return averages;
}
