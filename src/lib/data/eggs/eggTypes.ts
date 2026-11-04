export type EggChargerType = "USB_C" | "FIVE_PIN" | "UNKNOWN";

/** 에그를 관리하는 파트. 1·2파트는 공용 관리대장, 3파트는 별도 관리대장을 쓴다. */
export type EggPart = "P12" | "P3";

export const EGG_PARTS: EggPart[] = ["P12", "P3"];

export type EggAvailability = "available" | "rented" | "overdue" | "reserved" | "data_exhausted";

/**
 * 화면에서 쓰는 표준 에그 기기 타입.
 * 날짜는 모두 KST 기준 "YYYY-MM-DD" 문자열로 다룬다.
 * 문자열 비교가 곧 날짜 비교라서 시간대에 따라 하루가 밀리는 문제를 피할 수 있다.
 */
export interface EggDeviceSummary {
  id: string;
  part: EggPart;
  number: number;
  label: string;
  wifiName: string;
  serialNumber: string;
  wifiPassword: string;
  modelCode: string | null;
  chargerType: EggChargerType;
  speedMbps: number | null;
  storageLocation: string;
  monthlyDataGb: number | null;
  contractEndsOn: string | null;
  cautionNote: string | null;
  dataExhausted: boolean;
  dataExhaustedAt: string | null;
  dataExhaustedBy: string | null;
}

export interface EggRentalRecord {
  id: string;
  eggDeviceId: string;
  borrowerName: string;
  borrowerEmail: string | null;
  courseName: string;
  startDate: string;
  returnDueDate: string;
  actualUseNote: string | null;
  note: string | null;
  returned: boolean;
  returnedAt: string | null;
}

export interface EggRentalInput {
  eggDeviceId: string;
  borrowerName: string;
  borrowerEmail?: string | null;
  courseName: string;
  startDate: string;
  returnDueDate: string;
  actualUseNote?: string | null;
  note?: string | null;
}

export interface EggDeviceInput {
  part: EggPart;
  number: number;
  label: string;
  wifiName: string;
  serialNumber: string;
  wifiPassword: string;
  modelCode?: string | null;
  chargerType: EggChargerType;
  speedMbps?: number | null;
  storageLocation: string;
  monthlyDataGb?: number | null;
  contractEndsOn?: string | null;
  cautionNote?: string | null;
}

export interface EggGuideContent {
  part: EggPart;
  content: string;
  updatedAt: string;
  updatedBy: string | null;
}

export const EGG_PART_LABEL: Record<EggPart, string> = {
  P12: "1·2파트",
  P3: "3파트"
};

/** URL 쿼리(?part=12|3)와 파트 값 변환 */
export const EGG_PART_QUERY: Record<EggPart, string> = {
  P12: "12",
  P3: "3"
};

export function parseEggPartQuery(value: string | null | undefined): EggPart {
  return value === "3" ? "P3" : "P12";
}

export function isEggPart(value: unknown): value is EggPart {
  return value === "P12" || value === "P3";
}

export const EGG_CHARGER_LABEL: Record<EggChargerType, string> = {
  USB_C: "C타입",
  FIVE_PIN: "5핀",
  UNKNOWN: "미확인"
};

export const EGG_AVAILABILITY_LABEL: Record<EggAvailability, string> = {
  available: "사용 가능",
  rented: "대여 중",
  overdue: "반납 지연",
  reserved: "대여 예정",
  data_exhausted: "데이터 소진"
};

/** hub-om 공통 .status 클래스에 맞춘 상태별 배지 클래스 */
export const EGG_AVAILABILITY_CLASS: Record<EggAvailability, string> = {
  available: "status active",
  rented: "status planned-assignment",
  overdue: "status needs-assignment",
  reserved: "status done",
  data_exhausted: "status egg-muted"
};
