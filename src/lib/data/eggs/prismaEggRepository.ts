import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/lib/data/prisma";
import { isValidDate } from "./eggAvailability";
import { EggDeviceDuplicateError, EggRentalConflictError, type EggRepository, type EggReturnResult } from "./eggRepository";
import type {
  EggChargerType,
  EggDeviceInput,
  EggDeviceSummary,
  EggGuideContent,
  EggPart,
  EggRentalInput,
  EggRentalRecord
} from "./eggTypes";

/** @db.Date 컬럼은 UTC 자정으로 저장되므로 앞 10자리를 그대로 쓰면 KST 날짜와 같다 */
function toDateString(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function toDateColumn(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function requireDate(value: string, field: string): Date {
  if (!isValidDate(value)) {
    throw new Error(`${field}는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  return toDateColumn(value);
}

interface DeviceRow {
  id: string;
  part: string;
  number: number;
  label: string;
  wifiName: string;
  serialNumber: string;
  wifiPassword: string;
  modelCode: string | null;
  chargerType: string;
  speedMbps: number | null;
  storageLocation: string;
  monthlyDataGb: number | null;
  contractEndsOn: Date | null;
  cautionNote: string | null;
  dataExhausted: boolean;
  dataExhaustedAt: Date | null;
  dataExhaustedBy: string | null;
}

interface RentalRow {
  id: string;
  eggDeviceId: string;
  borrowerName: string;
  borrowerEmail: string | null;
  courseName: string;
  startDate: Date;
  returnDueDate: Date;
  actualUseNote: string | null;
  note: string | null;
  returnedAt: Date | null;
}

function mapDevice(row: DeviceRow): EggDeviceSummary {
  return {
    id: row.id,
    part: row.part as EggPart,
    number: row.number,
    label: row.label,
    wifiName: row.wifiName,
    serialNumber: row.serialNumber,
    wifiPassword: row.wifiPassword,
    modelCode: row.modelCode,
    chargerType: row.chargerType as EggChargerType,
    speedMbps: row.speedMbps,
    storageLocation: row.storageLocation,
    monthlyDataGb: row.monthlyDataGb,
    contractEndsOn: toDateString(row.contractEndsOn),
    cautionNote: row.cautionNote,
    dataExhausted: row.dataExhausted,
    dataExhaustedAt: row.dataExhaustedAt ? row.dataExhaustedAt.toISOString() : null,
    dataExhaustedBy: row.dataExhaustedBy
  };
}

function mapRental(row: RentalRow): EggRentalRecord {
  return {
    id: row.id,
    eggDeviceId: row.eggDeviceId,
    borrowerName: row.borrowerName,
    borrowerEmail: row.borrowerEmail,
    courseName: row.courseName,
    startDate: row.startDate.toISOString().slice(0, 10),
    returnDueDate: row.returnDueDate.toISOString().slice(0, 10),
    actualUseNote: row.actualUseNote,
    note: row.note,
    returned: Boolean(row.returnedAt),
    returnedAt: row.returnedAt ? row.returnedAt.toISOString() : null
  };
}

function mapGuide(row: { part: string; content: string; updatedAt: Date; updatedBy: string | null }): EggGuideContent {
  return {
    part: row.part as EggPart,
    content: row.content,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
  };
}

const DEVICE_SELECT = {
  id: true,
  part: true,
  number: true,
  label: true,
  wifiName: true,
  serialNumber: true,
  wifiPassword: true,
  modelCode: true,
  chargerType: true,
  speedMbps: true,
  storageLocation: true,
  monthlyDataGb: true,
  contractEndsOn: true,
  cautionNote: true,
  dataExhausted: true,
  dataExhaustedAt: true,
  dataExhaustedBy: true
} as const;

const RENTAL_SELECT = {
  id: true,
  eggDeviceId: true,
  borrowerName: true,
  borrowerEmail: true,
  courseName: true,
  startDate: true,
  returnDueDate: true,
  actualUseNote: true,
  note: true,
  returnedAt: true
} as const;

export class PrismaEggRepository implements EggRepository {
  async listDevices(): Promise<EggDeviceSummary[]> {
    const prisma = getPrismaClient();
    const rows = await prisma.eggDevice.findMany({
      where: { deletedAt: null },
      orderBy: [{ part: "asc" }, { number: "asc" }],
      select: DEVICE_SELECT
    });
    return rows.map(mapDevice);
  }

  async listRentals(options?: { fromDate?: string }): Promise<EggRentalRecord[]> {
    const prisma = getPrismaClient();
    const fromDate = options?.fromDate;
    const rows = await prisma.eggRental.findMany({
      where: {
        deletedAt: null,
        ...(isValidDate(fromDate) ? { returnDueDate: { gte: toDateColumn(fromDate) } } : {})
      },
      orderBy: [{ startDate: "asc" }],
      select: RENTAL_SELECT
    });
    return rows.map(mapRental);
  }

  async createRental(input: EggRentalInput, actorEmail: string): Promise<EggRentalRecord> {
    const prisma = getPrismaClient();
    const startDate = requireDate(input.startDate, "대여 시작일");
    const returnDueDate = requireDate(input.returnDueDate, "반납 예정일");

    if (input.returnDueDate < input.startDate) {
      throw new Error("반납 예정일이 대여 시작일보다 앞설 수 없습니다.");
    }

    // 같은 에그의 쓰기를 기기 행 잠금으로 한 줄로 세워, 동시에 같은 기간을 예약해도 하나만 저장한다.
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM egg_devices WHERE id = ${input.eggDeviceId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length !== 1) throw new Error("에그를 찾을 수 없습니다.");
      const conflicts = await tx.eggRental.findMany({
        where: {
          eggDeviceId: input.eggDeviceId,
          deletedAt: null,
          returnedAt: null,
          startDate: { lte: returnDueDate },
          returnDueDate: { gte: startDate }
        },
        orderBy: [{ startDate: "asc" }],
        select: RENTAL_SELECT
      });
      if (conflicts.length > 0) throw new EggRentalConflictError(conflicts.map(mapRental));
      const row = await tx.eggRental.create({
        data: {
          eggDeviceId: input.eggDeviceId,
          borrowerName: input.borrowerName,
          borrowerEmail: input.borrowerEmail ?? null,
          courseName: input.courseName,
          startDate,
          returnDueDate,
          actualUseNote: input.actualUseNote ?? null,
          note: input.note ?? null,
          createdBy: actorEmail
        },
        select: RENTAL_SELECT
      });
      return mapRental(row);
    });
  }

  /** 반납 처리. 같은 에그로 먼저 시작한 미반납 대여도 함께 닫는다 — 이유는 EggRepository.markReturned 참고 */
  async markReturned(rentalId: string, actorEmail: string): Promise<EggReturnResult> {
    const prisma = getPrismaClient();
    return prisma.$transaction(async (tx) => {
      const target = await tx.eggRental.findUnique({
        where: { id: rentalId },
        select: { id: true, eggDeviceId: true, startDate: true }
      });
      if (!target) throw new Error("대여를 찾을 수 없습니다.");
      const result = await tx.eggRental.updateMany({
        where: {
          eggDeviceId: target.eggDeviceId,
          deletedAt: null,
          returnedAt: null,
          OR: [{ id: target.id }, { startDate: { lte: target.startDate } }]
        },
        data: { returnedAt: new Date(), returnedBy: actorEmail }
      });
      return { returnedCount: result.count };
    });
  }

  /** 예약 취소는 물리 삭제가 아니라 소프트 삭제로 남긴다 */
  async cancelRental(rentalId: string, actorEmail: string): Promise<void> {
    const prisma = getPrismaClient();
    await prisma.eggRental.update({
      where: { id: rentalId },
      data: { deletedAt: new Date(), deletedBy: actorEmail }
    });
  }

  async setDataExhausted(deviceId: string, exhausted: boolean, actorName: string): Promise<void> {
    const prisma = getPrismaClient();
    await prisma.eggDevice.update({
      where: { id: deviceId },
      data: {
        dataExhausted: exhausted,
        dataExhaustedAt: exhausted ? new Date() : null,
        dataExhaustedBy: exhausted ? actorName : null
      }
    });
  }

  async createDevice(input: EggDeviceInput): Promise<EggDeviceSummary> {
    const prisma = getPrismaClient();
    try {
      const row = await prisma.eggDevice.create({
        data: this.toDeviceData(input),
        select: DEVICE_SELECT
      });
      return mapDevice(row);
    } catch (error) {
      throw duplicateOr(error);
    }
  }

  async updateDevice(deviceId: string, input: EggDeviceInput): Promise<EggDeviceSummary> {
    const prisma = getPrismaClient();
    try {
      const row = await prisma.eggDevice.update({
        where: { id: deviceId },
        data: this.toDeviceData(input),
        select: DEVICE_SELECT
      });
      return mapDevice(row);
    } catch (error) {
      throw duplicateOr(error);
    }
  }

  /** 주의사항은 파트마다 한 행만 쓴다 */
  async listGuides(): Promise<EggGuideContent[]> {
    const prisma = getPrismaClient();
    const rows = await prisma.eggGuide.findMany({
      select: { part: true, content: true, updatedAt: true, updatedBy: true }
    });
    return rows.map(mapGuide);
  }

  async saveGuide(part: EggPart, content: string, actorEmail: string): Promise<EggGuideContent> {
    const prisma = getPrismaClient();
    const row = await prisma.eggGuide.upsert({
      where: { part },
      update: { content, updatedBy: actorEmail },
      create: { part, content, updatedBy: actorEmail },
      select: { part: true, content: true, updatedAt: true, updatedBy: true }
    });
    return mapGuide(row);
  }

  private toDeviceData(input: EggDeviceInput) {
    return {
      part: input.part,
      number: input.number,
      label: input.label,
      wifiName: input.wifiName,
      serialNumber: input.serialNumber,
      wifiPassword: input.wifiPassword,
      modelCode: input.modelCode ?? null,
      chargerType: input.chargerType,
      speedMbps: input.speedMbps ?? null,
      storageLocation: input.storageLocation,
      monthlyDataGb: input.monthlyDataGb ?? null,
      contractEndsOn: isValidDate(input.contractEndsOn) ? toDateColumn(input.contractEndsOn) : null,
      cautionNote: input.cautionNote ?? null
    };
  }
}

/** 파트·번호 유일 제약 위반은 화면에서 409로 안내한다 */
function duplicateOr(error: unknown): unknown {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? new EggDeviceDuplicateError() : error;
}
