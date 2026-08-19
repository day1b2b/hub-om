import fs from "fs";
import os from "os";
import path from "path";
import { shiftDateString } from "./reminderDates";

// 같은 날 두 번 실행돼도(스케줄 재시도, 수동 실행이 겹칠 때) 같은 회차 DM이 두 번 가지 않게
// 발송한 키를 파일에 남긴다. 컨테이너가 재시작되면 사라지지만 최악의 결과가
// "같은 날 DM 1회 중복"이라, DB 테이블(마이그레이션)을 새로 만들지 않고 임시 파일을 쓴다.
const RETENTION_DAYS = 14;

interface SentEntry {
  date: string;
  key: string;
}

function logFile(): string {
  return process.env.REMINDER_SENT_LOG_FILE?.trim() || path.join(os.tmpdir(), "hub-om-reminder-sent.json");
}

function readEntries(): SentEntry[] {
  const file = logFile();
  if (!fs.existsSync(file)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as SentEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => Boolean(entry?.date && entry?.key)) : [];
  } catch {
    // 손상된 로그는 무시한다. 최악의 결과는 중복 발송이라 여기서 멈추지 않는다.
    return [];
  }
}

export function readSentKeys(): Set<string> {
  return new Set(readEntries().map((entry) => entry.key));
}

export function appendSentKeys(today: string, keys: string[]): void {
  if (keys.length === 0) return;

  const cutoff = shiftDateString(today, -RETENTION_DAYS);
  const kept = readEntries().filter((entry) => entry.date >= cutoff);
  const merged = [...kept, ...keys.map((key) => ({ date: today, key }))];

  try {
    fs.writeFileSync(logFile(), JSON.stringify(merged, null, 2), "utf-8");
  } catch (error) {
    // 로그를 못 써도 발송 자체는 이미 성공한 상태다. 실패만 남기고 넘어간다.
    console.error("[reminder] 발송 로그 저장 실패:", error);
  }
}
