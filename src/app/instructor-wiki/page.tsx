import { InstructorWiki } from "@/features/wiki/InstructorWiki";
import { buildInstructorRows } from "@/features/wiki/instructorWikiRows";
import { InstructorRecommendPanel } from "@/features/wiki/InstructorRecommendPanel";
import { recommendInstructorsByCriteria } from "@/features/wiki/instructorRecommendation";
import {
  aggregateInstructors,
  applyNotionLinks,
  attachCoachSummaries,
  mergeNotionNotes,
  type InstructorWikiProvenance
} from "@/features/wiki/instructorWikiModel";
import type { PeopleRow } from "@/features/people/PeopleDirectory";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getCoachRepository } from "@/lib/data/coachRepositoryFactory";
import { listInstructorNotes, resolveNotionLinkTargets } from "@/lib/data/instructorWikiStore";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
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

// 워크스페이스 공용 읽기는 짧은 TTL로 캐시한다(매 방문 재쿼리 방지). 코치 목록은 코치위키와 같은 키라 캐시를 공유한다.
const loadOperations = () =>
  cachedRead("operations:listOperations", () => timed("instructor-wiki:listOperations", () => getOperationRepository().listOperations()));
const loadNotes = () =>
  cachedRead("instructor-wiki:notes", () => timed("instructor-wiki:listInstructorNotes", () => listInstructorNotes()));
const loadCoaches = () =>
  cachedRead("coaches:listCoaches", () => timed("instructor-wiki:listCoaches", () => getCoachRepository().listCoaches()));

interface InstructorWikiView {
  rows: PeopleRow[];
  entriesCount: number;
  operationEntryCount: number;
  provenance: InstructorWikiProvenance;
}

/**
 * 목록 view(읽기 + 강사 집계 + rows 생성)를 통째로 만든다. 이 결과를 today 기준으로 캐시해
 * 반복 방문 시 DB 읽기뿐 아니라 800명 집계 CPU까지 건너뛴다(강사위키 서버 렌더 스파이크 원인).
 * 운영 현황 읽기 실패는 throw해서 캐시하지 않는다(다음 방문이 재시도).
 */
async function buildInstructorWikiView(today: string): Promise<InstructorWikiView> {
  const [operations, notes, coaches] = await Promise.all([
    loadOperations(),
    loadNotes(),
    // coach-db 보강은 best-effort. 미연결(로컬 dev 등)이면 빈 배열로 건너뛴다.
    loadCoaches().catch(() => [])
  ]);

  let entries = aggregateInstructors(operations);
  const linkTargets = resolveNotionLinkTargets(notes);
  // OM이 연결해 둔 노션 강사로 먼저 합친다. 운영 현황 표기가 달라 갈려 있던 같은 사람을 하나로.
  entries = applyNotionLinks(entries, linkTargets);
  const operationEntryCount = entries.length;

  // 강사 명단·프로필은 노션 강사 DB에서 온다(연결 키 = 노션 NO). 운영 배정이 없는 강사도 세운다.
  const notionNotes = notes.filter(
    (note) => note.notion && note.notionNo !== undefined && !linkTargets[(note.instructorName ?? "").trim()]
  );
  entries = mergeNotionNotes(entries, notionNotes);

  if (coaches.length > 0) attachCoachSummaries(entries, coaches);

  // 노션 명단이 목록의 기준이 되면 provenance도 노션이다. 노션 동기화 전에는 운영 현황만 남는다.
  const provenance: InstructorWikiProvenance =
    entries.length === 0 ? "empty" : notionNotes.length > 0 ? "notion" : "operations";

  // 섭외지양 표기 대상. 노션 강사 DB의 "섭외지양 여부"만 본다(수동 토글 없음).
  const recruitAvoidNames = notes
    .filter((note) => note.notion?.recruitAvoid)
    .map((note) => (note.instructorName ?? "").trim())
    .filter(Boolean);

  // 목록 요약은 서버에서 만들어 slim하게 내린다 — 코스 상세(courses[])는 상세 라우트에서만 쓴다.
  const rows = buildInstructorRows(entries, recruitAvoidNames, today, coachActivityPolicy.dormantMonths);
  return { rows, entriesCount: entries.length, operationEntryCount, provenance };
}

async function renderInstructorWikiPage(recommendMinor: string, recommendDate: string) {
  const today = seoulTodayKey();
  const wikiStartedAt = Date.now();

  // 집계 결과까지 캐시한다(today 기준). 실패하면 빈 목록 + 경고로 처리하고 캐시하지 않는다.
  let loadFailed = false;
  const view = await cachedRead(`instructor-wiki:view:${today}`, () => buildInstructorWikiView(today)).catch(() => {
    loadFailed = true;
    return { rows: [], entriesCount: 0, operationEntryCount: 0, provenance: "empty" as InstructorWikiProvenance };
  });

  // 강사 추천: 분야를 고른 뒤에만 계산한다(조건은 주소로 받는다). 운영 현황·노트는 공용 캐시에서 온다.
  let recommendation: ReturnType<typeof recommendInstructorsByCriteria> | null = null;
  if (recommendMinor) {
    try {
      const [operations, notes] = await Promise.all([loadOperations(), loadNotes()]);
      recommendation = recommendInstructorsByCriteria({
        minor: recommendMinor,
        date: recommendDate,
        operations,
        notes,
        today,
        dormantMonths: coachActivityPolicy.dormantMonths
      });
    } catch {
      // 추천 계산용 읽기 실패는 목록 표시를 막지 않는다.
    }
  }

  console.info(`[perf] instructor-wiki total ${Date.now() - wikiStartedAt}ms`);

  return (
    <InstructorWiki
      recommendOpen={recommendation !== null}
      recommendPanel={<InstructorRecommendPanel date={recommendDate} minor={recommendMinor} recommendation={recommendation} />}
      rows={view.rows}
      loadFailed={loadFailed}
      operationEntryCount={view.operationEntryCount}
      entriesCount={view.entriesCount}
      provenance={view.provenance}
    />
  );
}
