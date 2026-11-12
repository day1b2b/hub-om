import { isSupplyCategory, type SupplyItemInput } from "./supplyTypes";

export type SupplyItemParseResult = { ok: true; value: SupplyItemInput } | { ok: false; error: string };

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

/** 물품 등록/수정 입력값 검증. 화면과 API가 같은 규칙을 쓰도록 한 곳에 모았다. */
export function parseSupplyItemInput(raw: unknown): SupplyItemParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "요청 형식이 올바르지 않습니다." };
  const source = raw as Record<string, unknown>;

  if (!isSupplyCategory(source.category)) return { ok: false, error: "물품 종류가 올바르지 않습니다." };
  const label = readString(source, "label");
  if (!label) return { ok: false, error: "물품 이름을 입력해주세요." };
  const storageLocation = readString(source, "storageLocation");
  if (!storageLocation) return { ok: false, error: "보관 위치를 입력해주세요." };

  const sortOrder = Number(source.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    return { ok: false, error: "정렬 순서는 0 이상의 정수로 입력해주세요." };
  }

  return {
    ok: true,
    value: {
      category: source.category,
      label,
      components: readString(source, "components") || null,
      storageLocation,
      sortOrder,
      note: readString(source, "note") || null
    }
  };
}
