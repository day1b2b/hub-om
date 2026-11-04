import { EGG_CHARGER_LABEL } from "@/lib/data/eggs/eggTypes";
import type { EggDeviceSummary } from "@/lib/data/eggs/eggTypes";

/** 기기 카드에 붙는 짧은 특징 칩(충전 단자, 속도). 파트 공통 내용은 주의사항 영역에 둔다. */
export function getDeviceTraits(device: EggDeviceSummary): string[] {
  const traits: string[] = [];
  if (device.chargerType !== "UNKNOWN") traits.push(`${EGG_CHARGER_LABEL[device.chargerType]} 충전`);
  if (device.speedMbps) traits.push(`${device.speedMbps}Mbps`);
  return traits;
}

/** WiFi 이름과 일련번호가 모두 비어 있으면 관리대장에 정보가 아직 없는 기기다 */
export function isDeviceInfoMissing(device: EggDeviceSummary): boolean {
  return !device.wifiName.trim() && !device.serialNumber.trim();
}

const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 좁은 칸용 짧은 날짜: "10/28(화)" */
export function formatShortDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const weekday = KOREAN_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${weekday})`;
}

export function formatRange(start: string, end: string): string {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} ~ ${formatShortDate(end)}`;
}
