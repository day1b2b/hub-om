import { readFile } from "node:fs/promises";
import type { CompanyBusinessInfoRepository } from "./companyBusinessInfoRepository";
import { getCompanyBusinessInfoRepository } from "./companyBusinessInfoRepositoryFactory";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { disconnectPrismaClient } from "./prisma";

// 일괄 반영(화면 저장 API)으로 들어간 사업자등록증 정보는 갱신 시각이 반영한 날로 찍혔다.
// 원본(계산서 발행 신청서) 제출 시각으로 되돌리는 일회성 백필이다. 입력 파일은 고객사 정보라
// 저장소에 두지 않고 실행 환경에서 --input으로 넘긴다: [{ "companyId": "...", "updatedAt": "ISO 시각" }].

export interface UpdatedAtBackfillEntry { companyId: string; updatedAt: Date }

export type UpdatedAtBackfillStatus = "candidate" | "already" | "changedSince" | "missing";

export interface CompanyBusinessInfoUpdatedAtBackfillSummary {
  apply: boolean;
  counts: Record<UpdatedAtBackfillStatus, number>;
  /** 건너뛴 companyId만 담는다 — 값은 출력하지 않는다. */
  skipped: { companyId: string; status: "changedSince" | "missing" }[];
  updatedCount: number;
}

interface Dependencies {
  repository(): CompanyBusinessInfoRepository;
  readInput(path: string): Promise<string>;
  close(): Promise<void>;
}

const defaults: Dependencies = {
  repository: getCompanyBusinessInfoRepository,
  readInput: path => readFile(path, "utf8"),
  close: disconnectPrismaClient
};

/** 서울 기준 "YYYY-MM-DD". */
function seoulDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

export function parseUpdatedAtBackfillInput(text: string): UpdatedAtBackfillEntry[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("COMPANY_BUSINESS_INFO_UPDATED_AT_BACKFILL_INVALID_INPUT");
  const seen = new Set<string>();
  return raw.map((item: { companyId?: unknown; updatedAt?: unknown } | null) => {
    const updatedAt = typeof item?.updatedAt === "string" ? new Date(item.updatedAt) : new Date(NaN);
    if (typeof item?.companyId !== "string" || item.companyId === "" || seen.has(item.companyId) || Number.isNaN(updatedAt.getTime())) {
      throw new Error("COMPANY_BUSINESS_INFO_UPDATED_AT_BACKFILL_INVALID_INPUT");
    }
    seen.add(item.companyId);
    return { companyId: item.companyId, updatedAt };
  });
}

export async function runCompanyBusinessInfoUpdatedAtBackfillCommand(
  args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults,
): Promise<CompanyBusinessInfoUpdatedAtBackfillSummary> {
  const apply = args.includes("--apply");
  const input = argValue(args, "input");
  // 지금 갱신일이 이 날짜(일괄 반영일)인 기업만 바꾼다 — 그 뒤 화면에서 직접 고친 기업은 건드리지 않는다.
  const onlyIfCurrentDate = argValue(args, "only-if-current-date");
  if (!input || !onlyIfCurrentDate || !/^\d{4}-\d{2}-\d{2}$/.test(onlyIfCurrentDate)) {
    throw new Error("COMPANY_BUSINESS_INFO_UPDATED_AT_BACKFILL_ARGUMENTS_REQUIRED");
  }
  if (apply && !args.includes("--backup-confirmed")) throw new Error("COMPANY_BUSINESS_INFO_UPDATED_AT_BACKFILL_CONFIRMATION_REQUIRED");

  const entries = parseUpdatedAtBackfillInput(await dependencies.readInput(input));
  let result: CompanyBusinessInfoUpdatedAtBackfillSummary | undefined;
  let failed = false;
  const scoped = getDataRepositoryOverride("companyBusinessInfo");
  try {
    if (!scoped) loadEnvironment();
    const repository = scoped ?? dependencies.repository();
    const counts: Record<UpdatedAtBackfillStatus, number> = { candidate: 0, already: 0, changedSince: 0, missing: 0 };
    const skipped: CompanyBusinessInfoUpdatedAtBackfillSummary["skipped"] = [];
    let updatedCount = 0;

    for (const entry of entries) {
      const current = await repository.get(entry.companyId);
      const currentAt = current?.businessInfoUpdatedAt ? new Date(current.businessInfoUpdatedAt) : null;
      const status: UpdatedAtBackfillStatus = !current ? "missing"
        : currentAt?.getTime() === entry.updatedAt.getTime() ? "already"
          : currentAt && seoulDate(currentAt) === onlyIfCurrentDate ? "candidate"
            : "changedSince";
      counts[status]++;
      if (status === "missing" || status === "changedSince") skipped.push({ companyId: entry.companyId, status });
      if (status === "candidate" && apply) {
        await repository.setBusinessInfoUpdatedAt(entry.companyId, entry.updatedAt);
        updatedCount++;
      }
    }
    result = { apply, counts, skipped, updatedCount };
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("COMPANY_BUSINESS_INFO_UPDATED_AT_BACKFILL_FAILED");
  return result;
}
