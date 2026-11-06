import type { SupplyCategory, SupplyItemSummary, SupplyRentalInput, SupplyRentalRecord } from "./supplyTypes";

/** 고른 물품 중 하나라도 겹치는 기간에 미반납 대여가 있다. 저장소가 겹침 확인과 저장을 한 트랜잭션에서 한다. */
export class SupplyRentalConflictError extends Error {
  readonly conflicts: SupplyRentalRecord[];
  constructor(conflicts: SupplyRentalRecord[]) {
    super("SUPPLY_RENTAL_CONFLICT");
    this.name = "SupplyRentalConflictError";
    this.conflicts = conflicts;
  }
}

/** 고른 물품이 없거나, 지워졌거나, 다른 종류다. */
export class SupplyItemNotFoundError extends Error {
  constructor() {
    super("SUPPLY_ITEM_NOT_FOUND");
    this.name = "SupplyItemNotFoundError";
  }
}

/**
 * 운영물품 대여 데이터 접근 계약.
 * 화면은 이 인터페이스만 사용하고 Prisma 모델이나 테이블 구조를 직접 알지 못한다.
 * createRental은 겹치는 미반납 대여가 있으면 저장하지 않고 SupplyRentalConflictError를 던진다.
 */
export interface SupplyRepository {
  listItems(category: SupplyCategory): Promise<SupplyItemSummary[]>;
  listRentals(category: SupplyCategory, options?: { fromDate?: string }): Promise<SupplyRentalRecord[]>;
  createRental(input: SupplyRentalInput, actorEmail: string): Promise<SupplyRentalRecord>;
  markReturned(rentalId: string, actorEmail: string): Promise<void>;
  cancelRental(rentalId: string, actorEmail: string): Promise<void>;
}
