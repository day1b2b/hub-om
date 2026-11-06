import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { encodeMongoRuntimeDocument } from "../mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "../mongoOperationStore";
import { assertMongoReadStoreReady } from "../mongoReadStore";
import { isValidDate } from "../eggs/eggAvailability";
import { SupplyItemNotFoundError, SupplyRentalConflictError, type SupplyRepository } from "./supplyRepository";
import type { SupplyCategory, SupplyItemSummary, SupplyRentalInput, SupplyRentalRecord } from "./supplyTypes";

/** 운영물품 저장소가 여는 컬렉션. 준비는 scripts/prepare-mongodb-egg-supply-collections.ts가 한다. */
export const SUPPLY_REPOSITORY_MODELS = ["SupplyItem", "SupplyRental", "SupplyRentalItem"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };

/** 날짜 컬럼은 UTC 자정으로 저장하므로 앞 10자리가 곧 KST 날짜다(Prisma 구현과 같다). */
const dateColumn = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateKey = (value: unknown) => (value as Date).toISOString().slice(0, 10);

const item = (row: MongoRow): SupplyItemSummary => ({
  id: row.id as string, category: row.category as SupplyCategory, label: row.label as string, components: row.components as string | null,
  storageLocation: row.storageLocation as string, sortOrder: row.sortOrder as number, note: row.note as string | null
});
const rental = (row: MongoRow, itemIds: string[]): SupplyRentalRecord => ({
  id: row.id as string, itemIds, borrowerName: row.borrowerName as string, borrowerEmail: row.borrowerEmail as string | null,
  courseName: row.courseName as string, startDate: dateKey(row.startDate), returnDueDate: dateKey(row.returnDueDate),
  note: row.note as string | null, returned: row.returnedAt instanceof Date, returnedAt: row.returnedAt instanceof Date ? row.returnedAt.toISOString() : null
});
const passThrough = (error: unknown) =>
  error instanceof MongoOperationError || error instanceof SupplyRentalConflictError || error instanceof SupplyItemNotFoundError;

/** Opens prepared storage only. 대여자 이름 등 개인정보 필드는 MongoOperationStore 계약대로 암호화된다. */
export class MongoSupplyRepository implements SupplyRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, SUPPLY_REPOSITORY_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoSupplyRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("SUPPLY_OPEN_FAILED"); }
  }
  private async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); }
    catch (error) { if (passThrough(error)) throw error; throw new MongoOperationError("SUPPLY_READ_FAILED"); }
    finally { await session.endSession(); }
  }
  /** 쓰기 충돌(TransientTransactionError)은 withTransaction이 다시 시도한다. */
  private async write<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try {
      return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 60_000 });
    } catch (error) { if (passThrough(error)) throw error; throw new MongoOperationError("SUPPLY_WRITE_FAILED"); }
    finally { await session.endSession(); }
  }
  /** 대여마다 함께 빌린 물품 id를 붙인다. */
  private async withItems(rows: MongoRow[], session: ClientSession): Promise<SupplyRentalRecord[]> {
    const ids = rows.map(row => row.id as string);
    const links = ids.length ? await this.store.scan("SupplyRentalItem", { rentalId: { $in: ids } }, session) : [];
    const byRental = new Map<string, string[]>();
    for (const link of links) byRental.set(link.rentalId as string, [...(byRental.get(link.rentalId as string) ?? []), link.itemId as string]);
    return rows.map(row => rental(row, (byRental.get(row.id as string) ?? []).sort()))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  private async updateRental(rentalId: string, fields: MongoRow) {
    await this.write(async session => {
      const before = await this.store.one("SupplyRental", { _id: rentalId }, session);
      if (!before) throw new Error("대여를 찾을 수 없습니다.");
      const row = completeMongoRow("SupplyRental", { ...before, ...fields, updatedAt: new Date() });
      const result = await this.store.collection("SupplyRental").replaceOne({ _id: rentalId }, encodeMongoRuntimeDocument("SupplyRental", row), { session });
      assertMongo(result.matchedCount === 1, "SUPPLY_WRITE_FAILED");
    });
  }

  async listItems(category: SupplyCategory) {
    return this.read(async session => (await this.store.scan("SupplyItem", { category, deletedAt: null }, session)).map(item)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)));
  }
  async listRentals(category: SupplyCategory, options?: { fromDate?: string }) {
    const fromDate = options?.fromDate;
    return this.read(async session => this.withItems(await this.store.scan("SupplyRental", {
      category, deletedAt: null, ...(isValidDate(fromDate) ? { returnDueDate: { $gte: dateColumn(fromDate) } } : {})
    }, session), session));
  }
  async createRental(input: SupplyRentalInput, actorEmail: string) {
    if (!isValidDate(input.startDate) || !isValidDate(input.returnDueDate)) throw new Error("대여 시작일과 반납 예정일은 YYYY-MM-DD 형식이어야 합니다.");
    if (input.returnDueDate < input.startDate) throw new Error("반납 예정일이 대여 시작일보다 앞설 수 없습니다.");
    const itemIds = [...new Set(input.itemIds)].sort();
    if (itemIds.length === 0) throw new SupplyItemNotFoundError();
    const startDate = dateColumn(input.startDate), returnDueDate = dateColumn(input.returnDueDate);
    return this.write(async session => {
      const now = new Date();
      // 고른 물품 문서를 먼저 고쳐 같은 물품의 예약을 한 줄로 세운다. 동시에 들어온 다른 예약은 쓰기 충돌로 다시 시도되고,
      // 다시 시도할 때 먼저 저장된 예약을 보고 겹침으로 거절된다.
      const locked = await this.store.collection("SupplyItem").updateMany(
        { _id: { $in: itemIds }, category: input.category, deletedAt: null }, { $set: { updatedAt: now } }, { session }
      );
      if (locked.matchedCount !== itemIds.length) throw new SupplyItemNotFoundError();
      const linked = [...new Set((await this.store.scan("SupplyRentalItem", { itemId: { $in: itemIds } }, session)).map(link => link.rentalId as string))];
      const open = linked.length ? await this.store.scan("SupplyRental", {
        _id: { $in: linked }, deletedAt: null, returnedAt: null, startDate: { $lte: returnDueDate }, returnDueDate: { $gte: startDate }
      }, session) : [];
      if (open.length > 0) throw new SupplyRentalConflictError(await this.withItems(open, session));
      const row = completeMongoRow("SupplyRental", {
        id: randomUUID(), category: input.category, borrowerName: input.borrowerName, borrowerEmail: input.borrowerEmail ?? null,
        courseName: input.courseName, startDate, returnDueDate, note: input.note ?? null, createdBy: actorEmail, createdAt: now, updatedAt: now
      });
      await this.store.collection("SupplyRental").insertOne(encodeMongoRuntimeDocument("SupplyRental", row), { session });
      await this.store.collection("SupplyRentalItem").insertMany(
        itemIds.map(itemId => encodeMongoRuntimeDocument("SupplyRentalItem", completeMongoRow("SupplyRentalItem", { rentalId: row.id, itemId }))), { session }
      );
      return rental(row, itemIds);
    });
  }
  /** 반납 처리. 함께 빌린 물품은 한 번에 반납된다. */
  async markReturned(rentalId: string, actorEmail: string) {
    await this.updateRental(rentalId, { returnedAt: new Date(), returnedBy: actorEmail });
  }
  /** 예약 취소는 물리 삭제가 아니라 소프트 삭제로 남긴다 */
  async cancelRental(rentalId: string, actorEmail: string) {
    await this.updateRental(rentalId, { deletedAt: new Date(), deletedBy: actorEmail });
  }
}
