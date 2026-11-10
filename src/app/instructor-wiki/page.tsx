import { InstructorWiki } from "@/features/wiki/InstructorWiki";
import { buildInstructorRows } from "@/features/wiki/instructorWikiRows";
import { InstructorRecommendPanel } from "@/features/wiki/InstructorRecommendPanel";
import { recommendInstructorsByCriteria } from "@/features/wiki/instructorRecommendation";
import {
  aggregateInstructors,
  applyNotionLinks,
  attachCoachSummaries,
  mergeNotionNotes,
  type InstructorWikiEntry,
  type InstructorWikiProvenance
} from "@/features/wiki/instructorWikiModel";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { listInstructorNotes, resolveNotionLinkTargets } from "@/lib/data/instructorWikiStore";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type { OperationSession } from "@/lib/data/operationTypes";
import { runCoachPublicRequest } from "@/lib/data/coachPublicComposition";
import { coachActivityPolicy, seoulTodayKey } from "@/lib/coaches/coachActivity";
import { cachedRead } from "@/lib/data/readCache";
import { timed } from "@/lib/observability/timed";

export const dynamic = "force-dynamic";

interface InstructorWikiPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function InstructorWikiPage({ searchParams }: InstructorWikiPageProps) {
  await requireWorkspaceSession();
  const params = await searchParams;
  return runCoachPublicRequest(() => renderInstructorWikiPage(firstParam(params.minor), firstParam(params.date)));
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function renderInstructorWikiPage(recommendMinor: string, recommendDate: string) {
  let entries: InstructorWikiEntry[] = [];
  let operations: OperationSession[] = [];
  let loadFailed = false;

  // 운영 현황·노션 노트·코치 보강은 서로 독립이라 동시에 읽는다(예전엔 순차 await라 지연이 합산됐다).
  // 각 구간 시간을 [perf] 로그로 남겨 병목을 데이터로 확인한다.
  const wikiStartedAt = Date.now();
  // 워크스페이스 공용 읽기는 짧은 TTL로 캐시한다(매 방문 재쿼리 방지). 실패는 캐시 밖에서 처리해
  // 순간 장애가 TTL 동안 굳지 않게 한다. 코치 목록은 코치위키와 같은 키라 캐시를 공유한다.
  const [operationsOrNull, notes, coaches] = await Promise.all([
    // 담당 코스·과정은 운영 현황에서 온다. 실패하면 null → 빈 목록 + 경고로 처리한다.
    cachedRead("operations:listOperations", () => timed("instructor-wiki:listOperations", () => getOperationRepository().listOperations())).catch(() => null),
    cachedRead("instructor-wiki:notes", () => timed("instructor-wiki:listInstructorNotes", () => listInstructorNotes())),
    // coach-db 보강은 best-effort. 미연결(로컬 dev 등)이면 빈 배열로 건너뛴다.
    cachedRead("coaches:listCoaches", () => timed("instructor-wiki:listCoaches", () => getCoachRepository().listCoaches())).catch(() => [])
  ]);

  if (operationsOrNull) {
    operations = operationsOrNull;
    entries = aggregateInstructors(operations);
  } else {
    loadFailed = true;
  }

  const linkTargets = resolveNotionLinkTargets(notes);

  // OM이 연결해 둔 노션 강사로 먼저 합친다. 운영 현황 표기가 달라 갈려 있던 같은 사람을 하나로.
  entries = applyNotionLinks(entries, linkTargets);

  const operationEntryCount = entries.length;

  // 강사 명단·프로필은 노션 강사 DB에서 온다(연결 키 = 노션 NO). 운영 배정이 없는 강사도 세운다.
  // 연결된 표기(linkTargets의 키)는 위에서 합쳐 없앴으므로 다시 세우지 않는다.
  const notionNotes = notes.filter(
    (note) => note.notion && note.notionNo !== undefined && !linkTargets[(note.instructorName ?? "").trim()]
  );
  entries = mergeNotionNotes(entries, notionNotes);

  // coach-db 전문분야/평가 보강(best-effort). 위 병렬 로드에서 받은 값만 쓴다.
  if (coaches.length > 0) {
    attachCoachSummaries(entries, coaches);
  }

  // 노션 명단이 목록의 기준이 되면 provenance도 노션이다. 노션 동기화 전에는 운영 현황만 남는다.
  const provenance: InstructorWikiProvenance =
    entries.length === 0 ? "empty" : notionNotes.length > 0 ? "notion" : "operations";

  // 섭외지양 표기 대상. 노션 강사 DB의 "섭외지양 여부"만 본다(수동 토글 없음).
  const recruitAvoidNames = notes
    .filter((note) => note.notion?.recruitAvoid)
    .map((note) => (note.instructorName ?? "").trim())
    .filter(Boolean);

  // 강사 추천: 분야를 고른 뒤에만 계산한다(조건은 주소로 받는다).
  const today = seoulTodayKey();
  const recommendation = recommendMinor
    ? recommendInstructorsByCriteria({
        minor: recommendMinor,
        date: recommendDate,
        operations,
        notes,
        today,
        dormantMonths: coachActivityPolicy.dormantMonths
      })
    : null;

  // 목록 요약은 서버에서 만들어 slim하게 내린다 — 코스 상세(courses[])는 상세 라우트에서만 쓰므로 목록 payload에 싣지 않는다.
  const rows = buildInstructorRows(entries, recruitAvoidNames, today, coachActivityPolicy.dormantMonths);

  console.info(`[perf] instructor-wiki total ${Date.now() - wikiStartedAt}ms`);

  return (
    <InstructorWiki
      recommendOpen={recommendation !== null}
      recommendPanel={<InstructorRecommendPanel date={recommendDate} minor={recommendMinor} recommendation={recommendation} />}
      rows={rows}
      loadFailed={loadFailed}
      operationEntryCount={operationEntryCount}
      entriesCount={entries.length}
      provenance={provenance}
    />
  );
}
