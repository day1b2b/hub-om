import type {
  EggDeviceInput,
  EggPart,
  EggDeviceSummary,
  EggGuideContent,
  EggRentalInput,
  EggRentalRecord
} from "./eggTypes";

/**
 * 에그 대여 데이터 접근 계약.
 * 화면은 이 인터페이스만 사용하고 Prisma 모델이나 테이블 구조를 직접 알지 못한다.
 */
export interface EggRepository {
  listDevices(): Promise<EggDeviceSummary[]>;
  listRentals(options?: { fromDate?: string }): Promise<EggRentalRecord[]>;
  createRental(input: EggRentalInput, actorEmail: string): Promise<EggRentalRecord>;
  markReturned(rentalId: string, actorEmail: string): Promise<void>;
  cancelRental(rentalId: string, actorEmail: string): Promise<void>;
  setDataExhausted(deviceId: string, exhausted: boolean, actorName: string): Promise<void>;
  createDevice(input: EggDeviceInput): Promise<EggDeviceSummary>;
  updateDevice(deviceId: string, input: EggDeviceInput): Promise<EggDeviceSummary>;
  listGuides(): Promise<EggGuideContent[]>;
  saveGuide(part: EggPart, content: string, actorEmail: string): Promise<EggGuideContent>;
}

export class EmptyEggRepository implements EggRepository {
  async listDevices(): Promise<EggDeviceSummary[]> {
    return [];
  }

  async listRentals(): Promise<EggRentalRecord[]> {
    return [];
  }

  async createRental(): Promise<EggRentalRecord> {
    throw new Error("에그 대여 저장소가 연결되지 않았습니다.");
  }

  async markReturned(): Promise<void> {
    throw new Error("에그 대여 저장소가 연결되지 않았습니다.");
  }

  async cancelRental(): Promise<void> {
    throw new Error("에그 대여 저장소가 연결되지 않았습니다.");
  }

  async setDataExhausted(): Promise<void> {
    throw new Error("에그 대여 저장소가 연결되지 않았습니다.");
  }

  async createDevice(): Promise<EggDeviceSummary> {
    throw new Error("에그 대여 저장소가 연결되지 않았습니다.");
  }

  async updateDevice(): Promise<EggDeviceSummary> {
    throw new Error("에그 대여 저장소가 연결되지 않았습니다.");
  }

  async listGuides(): Promise<EggGuideContent[]> {
    return [];
  }

  async saveGuide(): Promise<EggGuideContent> {
    throw new Error("에그 대여 저장소가 연결되지 않았습니다.");
  }
}
