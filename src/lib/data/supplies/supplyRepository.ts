import type { SupplyCategory, SupplyItemSummary, SupplyRentalInput, SupplyRentalRecord } from "./supplyTypes";

/**
 * 운영물품 대여 데이터 접근 계약.
 * 화면은 이 인터페이스만 사용하고 Prisma 모델이나 테이블 구조를 직접 알지 못한다.
 */
export interface SupplyRepository {
  listItems(category: SupplyCategory): Promise<SupplyItemSummary[]>;
  listRentals(category: SupplyCategory, options?: { fromDate?: string }): Promise<SupplyRentalRecord[]>;
  createRental(input: SupplyRentalInput, actorEmail: string): Promise<SupplyRentalRecord>;
  markReturned(rentalId: string, actorEmail: string): Promise<void>;
  cancelRental(rentalId: string, actorEmail: string): Promise<void>;
}
