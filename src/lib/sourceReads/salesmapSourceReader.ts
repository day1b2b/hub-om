import { getResourceReadCacheTtlMs, readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";
import { DisabledOperationSourceReader } from "./disabledSourceReader";
import type {
  CalendarResourceEvent,
  CourseBoardRecord,
  DiscussionReference,
  OperationSourceReader,
  SalesRecord,
  SourceReadIssue,
  SourceReadResult
} from "./sourceReadTypes";

/**
 * Salesmap(세일즈맵) 읽기 전용 reader.
 *
 * 딜(deal)을 읽어 표준 `SalesRecord`로 변환한다. 지금 스코프는 "코스ID 있는 딜만 읽어
 * 코스ID별로 금액(price/금액)을 합산" — 즉 코스ID → 매출 한 줄이다. 코스ID 없는 딜은 건너뛴다.
 * Google Calendar reader와 같은 방식으로, 실제 토큰/워크스페이스 값은 저장소에 두지 않고
 * 배포/로컬 환경변수로만 주입한다. 설정이 없으면 disabled reader처럼 빈 결과를 반환한다.
 * 실제로 붙이기 전 검증은 summarizeSalesmapDeals()(→ npm run salesmap:dry-run)로 확인한다.
 *
 * Salesmap API (확인 완료, 2026-08-05):
 *   - Base URL: https://salesmap.kr/api, 경로 prefix `/v2`
 *   - 인증: `Authorization: Bearer <token>` (설정>개인>연동>API>토큰 생성)
 *   - 딜 조회: `GET /v2/deal` (cursor 페이지네이션, pipelineName+pipelineStageName 필터)
 *   - 딜 필드: 이름/금액(price)/파이프라인/파이프라인 단계 + 커스텀 필드는 "평탄한 한글 키"
 *
 * ⚠️ 확정 필요(워크스페이스마다 다름):
 *   - 코스ID·고객사·과정명이 어떤 커스텀 필드 한글 키에 들어있는지 → 아래 env로 지정
 *   - `GET /v2/deal` 응답 봉투(data/nextCursor) 실제 키 이름 → 실제 호출로 1회 확인
 */

const DEFAULT_BASE_URL = "https://salesmap.kr/api";
const DEFAULT_MAX_PAGES = 20;

const DEFAULT_FIELD_COURSE_ID = "코스ID";
const DEFAULT_FIELD_COMPANY = "고객사";
const DEFAULT_FIELD_COURSE_NAME = "과정명";

interface SalesmapConfig {
  apiToken: string;
  baseUrl: string;
  pipelineName: string;
  pipelineStageName: string;
  maxPages: number;
  fieldCourseId: string;
  fieldCompany: string;
  fieldCourseName: string;
}

/** Salesmap 딜 1건. 커스텀 필드는 평탄한 한글 키라 인덱스 시그니처로 함께 받는다. */
interface SalesmapDeal {
  id?: string;
  RecordId?: string;
  이름?: string;
  price?: number;
  금액?: number;
  [flattenedKoreanKey: string]: unknown;
}

interface SalesmapDealListResponse {
  data?: SalesmapDeal[];
  deals?: SalesmapDeal[];
  items?: SalesmapDeal[];
  nextCursor?: string | null;
}

let cachedSalesRead: TimedCacheEntry<SourceReadResult<SalesRecord>> | null = null;

export class SalesmapSourceReader implements OperationSourceReader {
  private readonly disabledReader = new DisabledOperationSourceReader();

  constructor(private readonly config = readSalesmapConfig()) {}

  readCourseBoard(): Promise<SourceReadResult<CourseBoardRecord>> {
    return this.disabledReader.readCourseBoard();
  }

  readCalendarEvents(): Promise<SourceReadResult<CalendarResourceEvent>> {
    return this.disabledReader.readCalendarEvents();
  }

  readDiscussionReferences(): Promise<SourceReadResult<DiscussionReference>> {
    return this.disabledReader.readDiscussionReferences();
  }

  async readSalesRecords(): Promise<SourceReadResult<SalesRecord>> {
    const readAt = new Date().toISOString();
    const issues = validateSalesmapConfig(this.config);

    if (issues.length > 0) {
      return { source: "sales", status: "failed", readAt, items: [], issues };
    }

    const { entry, value } = await readTimedCache(
      cachedSalesRead,
      getResourceReadCacheTtlMs(),
      () => this.readFreshSalesRecords()
    );

    cachedSalesRead = entry;
    return value;
  }

  private async readFreshSalesRecords(): Promise<SourceReadResult<SalesRecord>> {
    const readAt = new Date().toISOString();

    try {
      const deals = await fetchAllDeals(this.config);
      return {
        source: "sales",
        status: "ok",
        readAt,
        items: aggregateSalesRecords(deals, this.config),
        issues: []
      };
    } catch {
      return {
        source: "sales",
        status: "failed",
        readAt,
        items: [],
        issues: [
          {
            code: "salesmap_read_failed",
            message: "Salesmap deals could not be read.",
            recoverable: true
          }
        ]
      };
    }
  }
}

export function hasSalesmapConfig(): boolean {
  return Boolean(process.env.SALESMAP_API_TOKEN);
}

function readSalesmapConfig(): SalesmapConfig {
  return {
    apiToken: process.env.SALESMAP_API_TOKEN?.trim() ?? "",
    baseUrl: (process.env.SALESMAP_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    pipelineName: process.env.SALESMAP_DEAL_PIPELINE_NAME?.trim() ?? "",
    pipelineStageName: process.env.SALESMAP_DEAL_STAGE_NAME?.trim() ?? "",
    maxPages: parsePositiveInteger(process.env.SALESMAP_MAX_PAGES, DEFAULT_MAX_PAGES),
    fieldCourseId: process.env.SALESMAP_FIELD_COURSE_ID?.trim() || DEFAULT_FIELD_COURSE_ID,
    fieldCompany: process.env.SALESMAP_FIELD_COMPANY?.trim() || DEFAULT_FIELD_COMPANY,
    fieldCourseName: process.env.SALESMAP_FIELD_COURSE_NAME?.trim() || DEFAULT_FIELD_COURSE_NAME
  };
}

function validateSalesmapConfig(config: SalesmapConfig): SourceReadIssue[] {
  const issues: SourceReadIssue[] = [];
  if (!config.apiToken) {
    issues.push({
      code: "salesmap_api_token_missing",
      message: "Salesmap reader is not fully configured.",
      recoverable: true
    });
  }
  return issues;
}

async function fetchAllDeals(config: SalesmapConfig): Promise<SalesmapDeal[]> {
  const deals: SalesmapDeal[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < config.maxPages; page += 1) {
    const url = new URL(`${config.baseUrl}/v2/deal`);
    if (config.pipelineName && config.pipelineStageName) {
      url.searchParams.set("pipelineName", config.pipelineName);
      url.searchParams.set("pipelineStageName", config.pipelineStageName);
    }
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${config.apiToken}` }
    });
    if (!response.ok) {
      throw new Error(`salesmap_deal_list_failed_${response.status}`);
    }

    const payload = (await response.json()) as SalesmapDealListResponse;
    const pageDeals = payload.data ?? payload.deals ?? payload.items ?? [];
    deals.push(...pageDeals);

    cursor = payload.nextCursor ?? null;
    if (!cursor) break;
  }

  return deals;
}

interface AggregatedSale {
  courseId: string;
  companyName?: string;
  courseName?: string;
  revenue: number;
  dealCount: number;
}

/** 코스ID 있는 딜만 남겨 코스ID별로 묶고 금액을 합산한다. */
function aggregateByCourseId(deals: SalesmapDeal[], config: SalesmapConfig): Map<string, AggregatedSale> {
  const byCourseId = new Map<string, AggregatedSale>();

  for (const deal of deals) {
    const courseId = readCourseId(deal, config);
    if (!courseId) continue;

    const revenue = readNumberField(deal.price ?? deal["금액"]) ?? 0;
    const existing = byCourseId.get(courseId);

    if (existing) {
      existing.revenue += revenue;
      existing.dealCount += 1;
      existing.companyName ??= readCompanyName(deal, config);
      existing.courseName ??= readCourseName(deal, config);
    } else {
      byCourseId.set(courseId, {
        courseId,
        companyName: readCompanyName(deal, config),
        courseName: readCourseName(deal, config),
        revenue,
        dealCount: 1
      });
    }
  }

  return byCourseId;
}

function aggregateSalesRecords(deals: SalesmapDeal[], config: SalesmapConfig): SalesRecord[] {
  return [...aggregateByCourseId(deals, config).values()].map((sale) => ({
    sourceRecordId: sale.courseId,
    courseId: sale.courseId,
    companyName: sale.companyName,
    courseName: sale.courseName,
    revenue: sale.revenue,
    probability: undefined,
    sourceUrl: undefined
  }));
}

function readCourseId(deal: SalesmapDeal, config: SalesmapConfig): string | undefined {
  return readStringField(deal[config.fieldCourseId]);
}

function readCompanyName(deal: SalesmapDeal, config: SalesmapConfig): string | undefined {
  return readStringField(deal[config.fieldCompany]);
}

function readCourseName(deal: SalesmapDeal, config: SalesmapConfig): string | undefined {
  return readStringField(deal[config.fieldCourseName]) ?? readStringField(deal["이름"]);
}

function readStageName(deal: SalesmapDeal): string {
  return readStringField(deal["파이프라인 단계"]) ?? "(단계 없음)";
}

/**
 * 실제 연결 전 검증용 요약. DB에 쓰지 않고, 코스ID→매출이 깨끗한지 눈으로 보기 위한 값만 만든다.
 * - stageBreakdownForCourseIdDeals: 코스ID 붙은 딜이 어떤 파이프라인 단계에 있는지("붙을걸?" 검증)
 * - multiDealCourseIds: 코스ID 하나에 딜이 여러 개인 케이스(합산 타당성 확인)
 */
export interface SalesmapDealsSummary {
  totalDeals: number;
  withCourseId: number;
  withoutCourseId: number;
  distinctCourseIds: number;
  stageBreakdownForCourseIdDeals: Array<{ stage: string; dealCount: number; revenueSum: number }>;
  multiDealCourseIds: Array<{ courseId: string; dealCount: number; revenueSum: number }>;
  aggregatedSample: Array<{ courseId: string; companyName: string; courseName: string; revenue: number; dealCount: number }>;
}

export async function summarizeSalesmapDeals(config: SalesmapConfig = readSalesmapConfig()): Promise<SalesmapDealsSummary> {
  const deals = await fetchAllDeals(config);
  const courseIdDeals = deals.filter((deal) => readCourseId(deal, config));

  const stageMap = new Map<string, { dealCount: number; revenueSum: number }>();
  for (const deal of courseIdDeals) {
    const stage = readStageName(deal);
    const revenue = readNumberField(deal.price ?? deal["금액"]) ?? 0;
    const entry = stageMap.get(stage) ?? { dealCount: 0, revenueSum: 0 };
    entry.dealCount += 1;
    entry.revenueSum += revenue;
    stageMap.set(stage, entry);
  }

  const aggregated = aggregateByCourseId(deals, config);

  return {
    totalDeals: deals.length,
    withCourseId: courseIdDeals.length,
    withoutCourseId: deals.length - courseIdDeals.length,
    distinctCourseIds: aggregated.size,
    stageBreakdownForCourseIdDeals: [...stageMap.entries()]
      .map(([stage, value]) => ({ stage, dealCount: value.dealCount, revenueSum: value.revenueSum }))
      .sort((a, b) => b.dealCount - a.dealCount),
    multiDealCourseIds: [...aggregated.values()]
      .filter((sale) => sale.dealCount > 1)
      .map((sale) => ({ courseId: sale.courseId, dealCount: sale.dealCount, revenueSum: sale.revenue }))
      .sort((a, b) => b.dealCount - a.dealCount),
    aggregatedSample: [...aggregated.values()].slice(0, 15).map((sale) => ({
      courseId: sale.courseId,
      companyName: sale.companyName ?? "",
      courseName: sale.courseName ?? "",
      revenue: sale.revenue,
      dealCount: sale.dealCount
    }))
  };
}

/** 커스텀 필드는 문자열이거나 관계 객체({id,name}) 또는 그 배열일 수 있다. */
function readStringField(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const first = value.find((item) => item != null);
    return first === undefined ? undefined : readStringField(first);
  }
  if (typeof value === "object") {
    const named = value as { name?: unknown };
    if (typeof named.name === "string") return named.name.trim() || undefined;
  }
  return undefined;
}

function readNumberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
