import type {
  EggDeviceInput,
  EggPart,
  EggDeviceSummary,
  EggGuideContent,
  EggRentalInput,
  EggRentalRecord
} from "./eggTypes";

/** 같은 에그의 겹치는 기간에 미반납 대여가 있다. 저장소가 겹침 확인과 저장을 한 트랜잭션에서 한다. */
export class EggRentalConflictError extends Error {
  readonly conflicts: EggRentalRecord[];
  constructor(conflicts: EggRentalRecord[]) {
    super("EGG_RENTAL_CONFLICT");
    this.name = "EggRentalConflictError";
    this.conflicts = conflicts;
  }
}

/** 같은 파트·번호의 에그가 이미 있다. */
export class EggDeviceDuplicateError extends Error {
  constructor() {
    super("EGG_DEVICE_DUPLICATE");
    this.name = "EggDeviceDuplicateError";
  }
}

/**
 * 에그 대여 데이터 접근 계약.
 * 화면은 이 인터페이스만 사용하고 Prisma 모델이나 테이블 구조를 직접 알지 못한다.
 * createRental은 겹치는 미반납 대여가 있으면 저장하지 않고 EggRentalConflictError를 던진다.
 */
/** 반납 처리 결과. returnedCount는 이번에 함께 닫힌 대여 수(요청한 건 포함) */
export interface EggReturnResult {
  returnedCount: number;
}

export interface EggRepository {
  listDevices(): Promise<EggDeviceSummary[]>;
  listRentals(options?: { fromDate?: string }): Promise<EggRentalRecord[]>;
  createRental(input: EggRentalInput, actorEmail: string): Promise<EggRentalRecord>;
  /**
   * 반납 처리. 에그가 돌아왔다면 같은 에그로 이보다 먼저(시작일 같거나 이전) 시작한 대여도 이미 돌아온 것이므로,
   * 남아 있는 미반납 건을 함께 닫는다. 반납자·반납 일시는 실제로 버튼을 누른 사람과 그 시각으로 모두 같게 남긴다.
   */
  markReturned(rentalId: string, actorEmail: string): Promise<EggReturnResult>;
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

  async markReturned(): Promise<EggReturnResult> {
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
