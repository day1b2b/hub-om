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
// 요청을 몰아치지 않도록 페이지 사이 간격(ms)과 429(요청 제한) 재시도 설정.
const DEFAULT_PAGE_DELAY_MS = 300;
const MAX_RATE_LIMIT_RETRIES = 6;
const MAX_RETRY_WAIT_MS = 20000;

const DEFAULT_FIELD_COURSE_ID = "코스ID";
const DEFAULT_FIELD_COMPANY = "고객사";
const DEFAULT_FIELD_COURSE_NAME = "과정명";

interface SalesmapConfig {
  apiToken: string;
  baseUrl: string;
  pipelineName: string;
  pipelineStageName: string;
  maxPages: number;
  pageDelayMs: number;
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

interface SalesmapDealListData {
  dealList?: SalesmapDeal[];
  deals?: SalesmapDeal[];
  items?: SalesmapDeal[];
  nextCursor?: string | null;
}

interface SalesmapDealListResponse {
  success?: boolean;
  // 실제 응답은 { success, data: { dealList: [...], nextCursor } } 형태.
  // 과거 추정(배열이 바로 data)이나 다른 키도 관대하게 받는다.
  data?: SalesmapDealListData | SalesmapDeal[];
  dealList?: SalesmapDeal[];
  deals?: SalesmapDeal[];
  items?: SalesmapDeal[];
  nextCursor?: string | null;
}

/** 응답 봉투에서 이번 페이지 딜 배열과 다음 커서를 안전하게 꺼낸다. */
function extractDealPage(payload: SalesmapDealListResponse): {
  pageDeals: SalesmapDeal[];
  nextCursor: string | null;
} {
  const data = payload.data;

  if (Array.isArray(data)) {
    return { pageDeals: data, nextCursor: payload.nextCursor ?? null };
  }
  if (data && typeof data === "object") {
    const list = data.dealList ?? data.deals ?? data.items ?? [];
    return {
      pageDeals: Array.isArray(list) ? list : [],
      nextCursor: data.nextCursor ?? payload.nextCursor ?? null
    };
  }

  const fallback = payload.dealList ?? payload.deals ?? payload.items ?? [];
  return { pageDeals: Array.isArray(fallback) ? fallback : [], nextCursor: payload.nextCursor ?? null };
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

    // 실패(429/에러)는 캐시하지 않는다 → 제한이 풀리면 다음 호출에서 곧바로 다시 읽는다.
    cachedSalesRead = value.status === "failed" ? null : entry;
    return value;
  }

  private async readFreshSalesRecords(): Promise<SourceReadResult<SalesRecord>> {
    const readAt = new Date().toISOString();

    try {
      const { deals, truncated, cursorLoopDetected } = await fetchAllDeals(this.config);
      const { byCourseId, skippedNoAmount, skippedNonPositive } = aggregateByCourseId(deals, this.config);
      const issues: SourceReadIssue[] = [];

      if (skippedNoAmount > 0) {
        issues.push({
          code: "salesmap_deal_missing_amount",
          message: `금액이 없는 딜 ${skippedNoAmount}건을 건너뛰었습니다.`,
          recoverable: true
        });
      }

      if (skippedNonPositive > 0) {
        issues.push({
          code: "salesmap_deal_non_positive_amount",
          message: `합산 금액이 0 이하인 코스ID ${skippedNonPositive}건을 제외했습니다(환불 등 확인 필요).`,
          recoverable: true
        });
      }

      if (truncated) {
        issues.push({
          code: "salesmap_deal_pagination_truncated",
          message: `딜이 많아 일부만 읽었습니다(최대 ${this.config.maxPages}페이지). 전체가 반영되지 않을 수 있습니다.`,
          recoverable: true
        });
      }

      if (cursorLoopDetected) {
        issues.push({
          code: "salesmap_cursor_loop",
          message: "세일즈맵 페이지 커서가 비정상 반복되어 중간에 멈췄습니다. 전체가 반영되지 않을 수 있습니다.",
          recoverable: true
        });
      }

      return {
        source: "sales",
        status: truncated || cursorLoopDetected ? "partial" : "ok",
        readAt,
        items: [...byCourseId.values()].map(salesRecordFromAggregate),
        issues
      };
    } catch (error) {
      return {
        source: "sales",
        status: "failed",
        readAt,
        items: [],
        issues: [
          {
            code: "salesmap_read_failed",
            message: `세일즈맵 딜을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
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
    pageDelayMs: parsePositiveInteger(process.env.SALESMAP_PAGE_DELAY_MS, DEFAULT_PAGE_DELAY_MS),
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

interface FetchAllDealsResult {
  deals: SalesmapDeal[];
  /** maxPages에 도달했는데도 다음 커서가 남아 딜을 다 읽지 못한 경우 true. */
  truncated: boolean;
  /** 커서가 진전 없이 반복돼(=API 이상) 도중에 멈춘 경우 true. */
  cursorLoopDetected: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 세일즈맵 GET 요청. 429(요청 제한)가 오면 잠시 쉬었다 재시도한다.
 * Retry-After 헤더가 있으면 그 시간을, 없으면 점점 늘어나는 대기시간을 쓴다.
 */
async function fetchSalesmapWithRetry(url: URL, apiToken: string): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await fetch(url, { headers: { authorization: `Bearer ${apiToken}` } });
    if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return response;

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : attempt * 3000;
    await sleep(Math.min(waitMs, MAX_RETRY_WAIT_MS));
  }
  return fetch(url, { headers: { authorization: `Bearer ${apiToken}` } });
}

async function fetchAllDeals(config: SalesmapConfig): Promise<FetchAllDealsResult> {
  const deals: SalesmapDeal[] = [];
  const seenDealIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let cursorLoopDetected = false;

  for (let page = 0; page < config.maxPages; page += 1) {
    const url = new URL(`${config.baseUrl}/v2/deal`);
    if (config.pipelineName && config.pipelineStageName) {
      url.searchParams.set("pipelineName", config.pipelineName);
      url.searchParams.set("pipelineStageName", config.pipelineStageName);
    }
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetchSalesmapWithRetry(url, config.apiToken);
    if (!response.ok) {
      throw new Error(`Salesmap API가 HTTP ${response.status}로 응답했습니다.`);
    }

    const payload = (await response.json()) as SalesmapDealListResponse;
    const { pageDeals, nextCursor } = extractDealPage(payload);

    // 같은 딜이 중복으로 오면(커서 꼬임 등) 매출이 부풀지 않도록 id 기준으로 한 번만 담는다.
    for (const deal of pageDeals) {
      const dealId = String(deal.id ?? deal.RecordId ?? "");
      if (dealId) {
        if (seenDealIds.has(dealId)) continue;
        seenDealIds.add(dealId);
      }
      deals.push(deal);
    }

    if (!nextCursor) {
      cursor = null;
      break;
    }
    // 커서가 진전 없이 반복되면(=API 이상) 무한/중복 페이지를 막기 위해 중단한다.
    if (seenCursors.has(nextCursor)) {
      cursorLoopDetected = true;
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;

    // 다음 페이지 요청 전 잠깐 간격을 둬 세일즈맵을 몰아치지 않는다.
    await sleep(config.pageDelayMs);
  }

  // 커서가 남아 있으면(페이지 상한 or 커서 반복) 다 못 읽었을 수 있다는 뜻(침묵 실패 방지).
  return { deals, truncated: Boolean(cursor), cursorLoopDetected };
}

interface AggregatedSale {
  courseId: string;
  companyName?: string;
  courseName?: string;
  revenue: number;
  dealCount: number;
  /** 합산된 딜들 중 가장 큰/작은 금액(금액 다른 다중 딜의 처리 대안: 합산/최대/최소). */
  maxDealAmount: number;
  minDealAmount: number;
}

interface AggregateResult {
  byCourseId: Map<string, AggregatedSale>;
  /** 코스ID는 있지만 금액이 비어 있어 합산에서 제외한 딜 수. */
  skippedNoAmount: number;
  /** 합산 결과가 0 이하라 제외한 코스ID 수(환불/상계 등 → 기존 매출을 덮어쓰지 않음). */
  skippedNonPositive: number;
}

/**
 * 코스ID 있는 딜만 남겨 코스ID별로 묶고 금액을 합산한다.
 * 금액이 비어 있는 딜은 0으로 처리하지 않고 제외한다(기존 매출을 0으로 덮어쓰는 사고 방지).
 */
function aggregateByCourseId(deals: SalesmapDeal[], config: SalesmapConfig): AggregateResult {
  const byCourseId = new Map<string, AggregatedSale>();
  let skippedNoAmount = 0;

  for (const deal of deals) {
    const courseId = readCourseId(deal, config);
    if (!courseId) continue;

    const revenue = readNumberField(deal.price ?? deal["금액"]);
    if (revenue === undefined) {
      skippedNoAmount += 1;
      continue;
    }

    const existing = byCourseId.get(courseId);
    if (existing) {
      existing.revenue += revenue;
      existing.dealCount += 1;
      if (revenue > existing.maxDealAmount) existing.maxDealAmount = revenue;
      if (revenue < existing.minDealAmount) existing.minDealAmount = revenue;
      existing.companyName ??= readCompanyName(deal, config);
      existing.courseName ??= readCourseName(deal, config);
    } else {
      byCourseId.set(courseId, {
        courseId,
        companyName: readCompanyName(deal, config),
        courseName: readCourseName(deal, config),
        revenue,
        dealCount: 1,
        maxDealAmount: revenue,
        minDealAmount: revenue
      });
    }
  }

  // 합산 결과가 0 이하인 코스ID는 제외한다(환불/상계 등으로 기존 매출을 0/음수로 덮어쓰지 않도록).
  let skippedNonPositive = 0;
  for (const [courseId, sale] of byCourseId) {
    if (sale.revenue <= 0) {
      byCourseId.delete(courseId);
      skippedNonPositive += 1;
    }
  }

  return { byCourseId, skippedNoAmount, skippedNonPositive };
}

function salesRecordFromAggregate(sale: AggregatedSale): SalesRecord {
  return {
    sourceRecordId: sale.courseId,
    courseId: sale.courseId,
    companyName: sale.companyName,
    courseName: sale.courseName,
    revenue: sale.revenue,
    probability: undefined,
    sourceUrl: undefined,
    dealCount: sale.dealCount,
    dealsSameAmount: sale.maxDealAmount === sale.minDealAmount,
    maxAmount: sale.maxDealAmount,
    minAmount: sale.minDealAmount
  };
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
  skippedNoAmount: number;
  truncated: boolean;
  distinctCourseIds: number;
  stageBreakdownForCourseIdDeals: Array<{ stage: string; dealCount: number; revenueSum: number }>;
  multiDealCourseIds: Array<{ courseId: string; dealCount: number; revenueSum: number }>;
  aggregatedSample: Array<{ courseId: string; companyName: string; courseName: string; revenue: number; dealCount: number }>;
}

export async function summarizeSalesmapDeals(config: SalesmapConfig = readSalesmapConfig()): Promise<SalesmapDealsSummary> {
  const { deals, truncated } = await fetchAllDeals(config);
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

  const { byCourseId: aggregated, skippedNoAmount } = aggregateByCourseId(deals, config);

  return {
    totalDeals: deals.length,
    withCourseId: courseIdDeals.length,
    withoutCourseId: deals.length - courseIdDeals.length,
    skippedNoAmount,
    truncated,
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
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.\-]/g, "");
    // 빈 문자열/부호만 남은 값은 "금액 없음"으로 본다(0으로 오인 금지).
    if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
