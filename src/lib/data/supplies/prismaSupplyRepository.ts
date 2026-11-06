import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/lib/data/prisma";
import { isValidDate } from "@/lib/data/eggs/eggAvailability";
import { SupplyItemNotFoundError, SupplyRentalConflictError, type SupplyRepository } from "./supplyRepository";
import type { SupplyCategory, SupplyItemSummary, SupplyRentalInput, SupplyRentalRecord } from "./supplyTypes";

/** @db.Date 컬럼은 UTC 자정으로 저장되므로 앞 10자리를 그대로 쓰면 KST 날짜와 같다 */
function toDateColumn(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const ITEM_SELECT = {
  id: true,
  category: true,
  label: true,
  components: true,
  storageLocation: true,
  sortOrder: true,
  note: true
} as const;

const RENTAL_SELECT = {
  id: true,
  borrowerName: true,
  borrowerEmail: true,
  courseName: true,
  startDate: true,
  returnDueDate: true,
  note: true,
  returnedAt: true,
  items: { select: { itemId: true } }
} as const;

interface RentalRow {
  id: string;
  borrowerName: string;
  borrowerEmail: string | null;
  courseName: string;
  startDate: Date;
  returnDueDate: Date;
  note: string | null;
  returnedAt: Date | null;
  items: { itemId: string }[];
}

function mapRental(row: RentalRow): SupplyRentalRecord {
  return {
    id: row.id,
    itemIds: row.items.map((item) => item.itemId),
    borrowerName: row.borrowerName,
    borrowerEmail: row.borrowerEmail,
    courseName: row.courseName,
    startDate: row.startDate.toISOString().slice(0, 10),
    returnDueDate: row.returnDueDate.toISOString().slice(0, 10),
    note: row.note,
    returned: Boolean(row.returnedAt),
    returnedAt: row.returnedAt ? row.returnedAt.toISOString() : null
  };
}

export class PrismaSupplyRepository implements SupplyRepository {
  async listItems(category: SupplyCategory): Promise<SupplyItemSummary[]> {
    const rows = await getPrismaClient().supplyItem.findMany({
      where: { category, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: ITEM_SELECT
    });
    return rows.map((row) => ({ ...row, category: row.category as SupplyCategory }));
  }

  async listRentals(category: SupplyCategory, options?: { fromDate?: string }): Promise<SupplyRentalRecord[]> {
    const fromDate = options?.fromDate;
    const rows = await getPrismaClient().supplyRental.findMany({
      where: {
        category,
        deletedAt: null,
        ...(isValidDate(fromDate) ? { returnDueDate: { gte: toDateColumn(fromDate) } } : {})
      },
      orderBy: [{ startDate: "asc" }],
      select: RENTAL_SELECT
    });
    return rows.map(mapRental);
  }

  async createRental(input: SupplyRentalInput, actorEmail: string): Promise<SupplyRentalRecord> {
    if (!isValidDate(input.startDate) || !isValidDate(input.returnDueDate)) {
      throw new Error("대여 시작일과 반납 예정일은 YYYY-MM-DD 형식이어야 합니다.");
    }
    if (input.returnDueDate < input.startDate) {
      throw new Error("반납 예정일이 대여 시작일보다 앞설 수 없습니다.");
    }

    const itemIds = [...new Set(input.itemIds)].sort();
    const startDate = toDateColumn(input.startDate);
    const returnDueDate = toDateColumn(input.returnDueDate);

    // 고른 물품 행을 같은 순서로 잠가 같은 물품의 쓰기를 한 줄로 세운다. 동시에 같은 기간을 예약해도 하나만 저장한다.
    return getPrismaClient().$transaction(async (tx) => {
      const locked = itemIds.length
        ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM supply_items WHERE id IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))}) AND category = ${input.category} AND deleted_at IS NULL ORDER BY id FOR UPDATE`
        : [];
      if (itemIds.length === 0 || locked.length !== itemIds.length) throw new SupplyItemNotFoundError();
      const conflicts = await tx.supplyRental.findMany({
        where: {
          category: input.category,
          deletedAt: null,
          returnedAt: null,
          startDate: { lte: returnDueDate },
          returnDueDate: { gte: startDate },
          items: { some: { itemId: { in: itemIds } } }
        },
        orderBy: [{ startDate: "asc" }],
        select: RENTAL_SELECT
      });
      if (conflicts.length > 0) throw new SupplyRentalConflictError(conflicts.map(mapRental));
      const row = await tx.supplyRental.create({
        data: {
          category: input.category,
          borrowerName: input.borrowerName,
          borrowerEmail: input.borrowerEmail ?? null,
          courseName: input.courseName,
          startDate,
          returnDueDate,
          note: input.note ?? null,
          createdBy: actorEmail,
          items: { create: itemIds.map((itemId) => ({ itemId })) }
        },
        select: RENTAL_SELECT
      });
      return mapRental(row);
    });
  }

  async markReturned(rentalId: string, actorEmail: string): Promise<void> {
    await getPrismaClient().supplyRental.update({
      where: { id: rentalId },
      data: { returnedAt: new Date(), returnedBy: actorEmail }
    });
  }

  /** 예약 취소는 물리 삭제가 아니라 소프트 삭제로 남긴다 */
  async cancelRental(rentalId: string, actorEmail: string): Promise<void> {
    await getPrismaClient().supplyRental.update({
      where: { id: rentalId },
      data: { deletedAt: new Date(), deletedBy: actorEmail }
    });
  }
}
