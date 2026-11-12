/** 운영물품 종류. 지금은 마이크만 쓴다. */
export type SupplyCategory = "mic";

export const SUPPLY_CATEGORY_LABEL: Record<SupplyCategory, string> = {
  mic: "마이크"
};

export interface SupplyItemSummary {
  id: string;
  category: SupplyCategory;
  label: string;
  /** 함께 나가는 구성품. 예: "무선 마이크 + 앰프" */
  components: string | null;
  storageLocation: string;
  sortOrder: number;
  note: string | null;
}

/** 물품 등록·수정 입력 (관리자 전용) */
export interface SupplyItemInput {
  category: SupplyCategory;
  label: string;
  components: string | null;
  storageLocation: string;
  sortOrder: number;
  note: string | null;
}

export interface SupplyRentalRecord {
  id: string;
  itemIds: string[];
  borrowerName: string;
  borrowerEmail: string | null;
  courseName: string;
  startDate: string;
  returnDueDate: string;
  note: string | null;
  returned: boolean;
  returnedAt: string | null;
}

export interface SupplyRentalInput {
  category: SupplyCategory;
  itemIds: string[];
  borrowerName: string;
  borrowerEmail?: string | null;
  courseName: string;
  startDate: string;
  returnDueDate: string;
  note?: string | null;
}

export type SupplyAvailability = "available" | "rented" | "overdue" | "reserved";

export const SUPPLY_AVAILABILITY_LABEL: Record<SupplyAvailability, string> = {
  available: "대여 가능",
  rented: "대여 중",
  overdue: "반납 지연",
  reserved: "예약 있음"
};

/** 에그 화면과 같은 상태 색을 쓴다 */
export const SUPPLY_AVAILABILITY_CLASS: Record<SupplyAvailability, string> = {
  available: "status active",
  rented: "status planned-assignment",
  overdue: "status needs-assignment",
  reserved: "status done"
};

export function isSupplyCategory(value: unknown): value is SupplyCategory {
  return value === "mic";
}
