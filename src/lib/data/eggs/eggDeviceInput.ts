import { isValidDate } from "./eggAvailability";
import { isEggPart, type EggChargerType, type EggDeviceInput } from "./eggTypes";

const CHARGER_TYPES: EggChargerType[] = ["USB_C", "FIVE_PIN", "UNKNOWN"];

export type ParseResult =
  | { ok: true; value: EggDeviceInput }
  | { ok: false; error: string };

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

/** 기기 등록/수정 입력값 검증. 화면과 API가 같은 규칙을 쓰도록 한 곳에 모았다. */
export function parseEggDeviceInput(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "요청 형식이 올바르지 않습니다." };
  }

  const source = raw as Record<string, unknown>;

  if (!isEggPart(source.part)) {
    return { ok: false, error: "관리 파트를 선택해주세요." };
  }
  const part = source.part;
  const number = Number(source.number);

  if (!Number.isInteger(number) || number < 1 || number > 999) {
    return { ok: false, error: "정렬 번호는 1 이상의 정수로 입력해주세요." };
  }

  const wifiName = readString(source, "wifiName");
  const serialNumber = readString(source, "serialNumber");
  const wifiPassword = readString(source, "wifiPassword");
  const storageLocation = readString(source, "storageLocation");

  // WiFi 이름·일련번호·비밀번호는 비워둘 수 있다. (3파트 에그는 비밀번호가 없고, USB형은 WiFi가 없다)
  if (!storageLocation) return { ok: false, error: "보관 위치를 입력해주세요." };

  const chargerTypeRaw = readString(source, "chargerType");
  const chargerType = CHARGER_TYPES.includes(chargerTypeRaw as EggChargerType)
    ? (chargerTypeRaw as EggChargerType)
    : "UNKNOWN";

  const label = readString(source, "label") || `${number}번`;
  const monthlyDataGbRaw = source.monthlyDataGb;
  const monthlyDataGb =
    monthlyDataGbRaw === null || monthlyDataGbRaw === undefined || monthlyDataGbRaw === ""
      ? null
      : Number(monthlyDataGbRaw);

  if (monthlyDataGb !== null && (!Number.isFinite(monthlyDataGb) || monthlyDataGb < 0)) {
    return { ok: false, error: "월 데이터 용량은 숫자로 입력해주세요." };
  }

  const speedMbpsRaw = source.speedMbps;
  const speedMbps =
    speedMbpsRaw === null || speedMbpsRaw === undefined || speedMbpsRaw === ""
      ? null
      : Number(speedMbpsRaw);

  if (speedMbps !== null && (!Number.isInteger(speedMbps) || speedMbps < 0)) {
    return { ok: false, error: "속도는 숫자(Mbps)로 입력해주세요." };
  }

  const contractEndsOn = readString(source, "contractEndsOn");
  if (contractEndsOn && !isValidDate(contractEndsOn)) {
    return { ok: false, error: "계약 만료일은 YYYY-MM-DD 형식으로 입력해주세요." };
  }

  return {
    ok: true,
    value: {
      part,
      number,
      label,
      wifiName,
      serialNumber,
      wifiPassword,
      modelCode: readString(source, "modelCode") || null,
      chargerType,
      speedMbps,
      storageLocation,
      monthlyDataGb,
      contractEndsOn: contractEndsOn || null,
      cautionNote: readString(source, "cautionNote") || null
    }
  };
}
