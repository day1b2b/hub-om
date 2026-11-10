import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import { encodeMongoRuntimeDocument } from "../mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "../mongoOperationStore";
import { assertMongoReadStoreReady } from "../mongoReadStore";
import { isValidDate } from "./eggAvailability";
import { EggDeviceDuplicateError, EggRentalConflictError, type EggRepository } from "./eggRepository";
import type { EggChargerType, EggDeviceInput, EggDeviceSummary, EggGuideContent, EggPart, EggRentalInput, EggRentalRecord } from "./eggTypes";

/** 에그 저장소가 여는 컬렉션. 준비는 scripts/prepare-mongodb-egg-supply-collections.ts가 한다. */
export const EGG_REPOSITORY_MODELS = ["EggDevice", "EggRental", "EggGuide"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };

/** 날짜 컬럼은 UTC 자정으로 저장하므로 앞 10자리가 곧 KST 날짜다(Prisma 구현과 같다). */
const dateColumn = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateKey = (value: unknown) => (value as Date).toISOString().slice(0, 10);
const optionalDateKey = (value: unknown) => (value instanceof Date ? dateKey(value) : null);
const optionalIso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);

const device = (row: MongoRow): EggDeviceSummary => ({
  id: row.id as string, part: row.part as EggPart, number: row.number as number, label: row.label as string,
  wifiName: row.wifiName as string, serialNumber: row.serialNumber as string, wifiPassword: row.wifiPassword as string,
  modelCode: row.modelCode as string | null, chargerType: row.chargerType as EggChargerType, speedMbps: row.speedMbps as number | null,
  storageLocation: row.storageLocation as string, monthlyDataGb: row.monthlyDataGb as number | null,
  contractEndsOn: optionalDateKey(row.contractEndsOn), cautionNote: row.cautionNote as string | null,
  dataExhausted: row.dataExhausted as boolean, dataExhaustedAt: optionalIso(row.dataExhaustedAt), dataExhaustedBy: row.dataExhaustedBy as string | null
});
const rental = (row: MongoRow): EggRentalRecord => ({
  id: row.id as string, eggDeviceId: row.eggDeviceId as string, borrowerName: row.borrowerName as string,
  borrowerEmail: row.borrowerEmail as string | null, courseName: row.courseName as string,
  startDate: dateKey(row.startDate), returnDueDate: dateKey(row.returnDueDate),
  actualUseNote: row.actualUseNote as string | null, note: row.note as string | null,
  returned: row.returnedAt instanceof Date, returnedAt: optionalIso(row.returnedAt)
});
const guide = (row: MongoRow): EggGuideContent => ({
  part: row.part as EggPart, content: row.content as string, updatedAt: (row.updatedAt as Date).toISOString(), updatedBy: row.updatedBy as string | null
});
const byStart = (a: EggRentalRecord, b: EggRentalRecord) => a.startDate.localeCompare(b.startDate);
const deviceFields = (input: EggDeviceInput) => ({
  part: input.part, number: input.number, label: input.label, wifiName: input.wifiName, serialNumber: input.serialNumber,
  wifiPassword: input.wifiPassword, modelCode: input.modelCode ?? null, chargerType: input.chargerType, speedMbps: input.speedMbps ?? null,
  storageLocation: input.storageLocation, monthlyDataGb: input.monthlyDataGb ?? null,
  contractEndsOn: isValidDate(input.contractEndsOn) ? dateColumn(input.contractEndsOn) : null, cautionNote: input.cautionNote ?? null
});
const isDuplicateKey = (error: unknown) => error instanceof MongoServerError && error.code === 11000;
const passThrough = (error: unknown) =>
  error instanceof MongoOperationError || error instanceof EggRentalConflictError || error instanceof EggDeviceDuplicateError;

/** Opens prepared storage only. WiFi 비밀번호 등 개인정보 필드는 MongoOperationStore 계약대로 암호화된다. */
export class MongoEggRepository implements EggRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, EGG_REPOSITORY_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoEggRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("EGG_OPEN_FAILED"); }
  }
  private async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); }
    catch (error) { if (passThrough(error)) throw error; throw new MongoOperationError("EGG_READ_FAILED"); }
    finally { await session.endSession(); }
  }
  /** 쓰기 충돌(TransientTransactionError)은 withTransaction이 다시 시도한다. */
  private async write<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try {
      return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 60_000 });
    } catch (error) {
      if (isDuplicateKey(error)) throw new EggDeviceDuplicateError();
      if (passThrough(error)) throw error;
      throw new MongoOperationError("EGG_WRITE_FAILED");
    } finally { await session.endSession(); }
  }
  private async replace(model: "EggDevice" | "EggRental" | "EggGuide", row: MongoRow, session: ClientSession) {
    const complete = completeMongoRow(model, row);
    const result = await this.store.collection(model).replaceOne({ _id: complete.id as string }, encodeMongoRuntimeDocument(model, complete), { session });
    assertMongo(result.matchedCount === 1, "EGG_WRITE_FAILED");
    return complete;
  }
  private async insert(model: "EggDevice" | "EggRental" | "EggGuide", row: MongoRow, session: ClientSession) {
    const complete = completeMongoRow(model, row);
    await this.store.collection(model).insertOne(encodeMongoRuntimeDocument(model, complete), { session });
    return complete;
  }

  async listDevices() {
    return this.read(async session => (await this.store.scan("EggDevice", { deletedAt: null }, session)).map(device)
      .sort((a, b) => a.part.localeCompare(b.part) || a.number - b.number));
  }
  async listRentals(options?: { fromDate?: string }) {
    const fromDate = options?.fromDate;
    return this.read(async session => (await this.store.scan("EggRental", {
      deletedAt: null, ...(isValidDate(fromDate) ? { returnDueDate: { $gte: dateColumn(fromDate) } } : {})
    }, session)).map(rental).sort(byStart));
  }
  async createRental(input: EggRentalInput, actorEmail: string) {
    if (!isValidDate(input.startDate) || !isValidDate(input.returnDueDate)) throw new Error("대여 시작일과 반납 예정일은 YYYY-MM-DD 형식이어야 합니다.");
    if (input.returnDueDate < input.startDate) throw new Error("반납 예정일이 대여 시작일보다 앞설 수 없습니다.");
    const startDate = dateColumn(input.startDate), returnDueDate = dateColumn(input.returnDueDate);
    return this.write(async session => {
      const now = new Date();
      // 기기 문서를 먼저 고쳐 같은 에그의 예약을 한 줄로 세운다. 동시에 들어온 다른 예약은 쓰기 충돌로 다시 시도되고,
      // 다시 시도할 때 먼저 저장된 예약을 보고 겹침으로 거절된다.
      const locked = await this.store.collection("EggDevice").updateOne({ _id: input.eggDeviceId, deletedAt: null }, { $set: { updatedAt: now } }, { session });
      if (locked.matchedCount !== 1) throw new Error("에그를 찾을 수 없습니다.");
      const conflicts = (await this.store.scan("EggRental", {
        eggDeviceId: input.eggDeviceId, deletedAt: null, returnedAt: null, startDate: { $lte: returnDueDate }, returnDueDate: { $gte: startDate }
      }, session)).map(rental).sort(byStart);
      if (conflicts.length > 0) throw new EggRentalConflictError(conflicts);
      return rental(await this.insert("EggRental", {
        id: randomUUID(), eggDeviceId: input.eggDeviceId, borrowerName: input.borrowerName, borrowerEmail: input.borrowerEmail ?? null,
        courseName: input.courseName, startDate, returnDueDate, actualUseNote: input.actualUseNote ?? null, note: input.note ?? null,
        createdBy: actorEmail, createdAt: now, updatedAt: now
      }, session));
    });
  }
  /** 반납 처리. 같은 에그로 먼저 시작한 미반납 대여도 함께 닫는다 — 이유는 EggRepository.markReturned 참고 */
  async markReturned(rentalId: string, actorEmail: string) {
    return this.write(async session => {
      const target = await this.store.one("EggRental", { _id: rentalId }, session);
      if (!target) throw new Error("대여를 찾을 수 없습니다.");
      const earlier = (await this.store.scan("EggRental", {
        eggDeviceId: target.eggDeviceId, deletedAt: null, returnedAt: null, startDate: { $lte: target.startDate }
      }, session)).filter(row => row._id !== rentalId);
      const closing = target.returnedAt ? earlier : [target, ...earlier];
      const now = new Date();
      for (const row of closing) await this.replace("EggRental", { ...row, returnedAt: now, returnedBy: actorEmail, updatedAt: now }, session);
      return { returnedCount: closing.length };
    });
  }
  /** 예약 취소는 물리 삭제가 아니라 소프트 삭제로 남긴다 */
  async cancelRental(rentalId: string, actorEmail: string) {
    await this.write(async session => {
      const before = await this.store.one("EggRental", { _id: rentalId }, session);
      if (!before) throw new Error("대여를 찾을 수 없습니다.");
      const now = new Date();
      await this.replace("EggRental", { ...before, deletedAt: now, deletedBy: actorEmail, updatedAt: now }, session);
    });
  }
  async setDataExhausted(deviceId: string, exhausted: boolean, actorName: string) {
    await this.write(async session => {
      const before = await this.store.one("EggDevice", { _id: deviceId }, session);
      if (!before) throw new Error("에그를 찾을 수 없습니다.");
      const now = new Date();
      await this.replace("EggDevice", {
        ...before, dataExhausted: exhausted, dataExhaustedAt: exhausted ? now : null, dataExhaustedBy: exhausted ? actorName : null, updatedAt: now
      }, session);
    });
  }
  async createDevice(input: EggDeviceInput) {
    return this.write(async session => {
      const now = new Date();
      return device(await this.insert("EggDevice", { id: randomUUID(), ...deviceFields(input), dataExhausted: false, createdAt: now, updatedAt: now }, session));
    });
  }
  async updateDevice(deviceId: string, input: EggDeviceInput) {
    return this.write(async session => {
      const before = await this.store.one("EggDevice", { _id: deviceId }, session);
      if (!before) throw new Error("에그를 찾을 수 없습니다.");
      return device(await this.replace("EggDevice", { ...before, ...deviceFields(input), updatedAt: new Date() }, session));
    });
  }
  /** 주의사항은 파트마다 한 문서만 쓴다 */
  async listGuides() {
    return this.read(async session => (await this.store.scan("EggGuide", {}, session)).map(guide));
  }
  async saveGuide(part: EggPart, content: string, actorEmail: string) {
    const save = () => this.write(async session => {
      const before = await this.store.one("EggGuide", { part }, session);
      const fields = { content, updatedBy: actorEmail, updatedAt: new Date() };
      return guide(before
        ? await this.replace("EggGuide", { ...before, ...fields }, session)
        : await this.insert("EggGuide", { id: randomUUID(), part, ...fields }, session));
    });
    // 같은 파트의 첫 저장이 동시에 들어와 유일 제약에 걸리면, 다시 읽어 수정으로 저장한다.
    try { return await save(); }
    catch (error) { if (error instanceof EggDeviceDuplicateError) return save(); throw error; }
  }
}
