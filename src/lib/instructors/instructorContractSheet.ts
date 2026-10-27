// 강사 계약 시트("B2B_NEW 강사 계약서 설문지" 응답) 리더.
// 코치 계약 시트(coaches/contractSheetSync)와 같은 방식 — B2B 공용 계정 OAuth로 구글 시트를 읽는다.
// 매칭에 필요한 칸만 뽑는다: 강의 코스 ID(J) · 강사명(O) · 강사 이메일(Q) · 계약 발송(C) · 최종완료(F).
// PII(이메일)는 매칭하는 순간에만 쓰고, 매칭 결과(운영현황 표기 → 노션 강사)만 저장한다. 시트 내용은 저장하지 않는다.
import { readGoogleServiceAccountConfig, readGoogleSpreadsheetRows } from "@/lib/coaches/googleServiceAccount";
import { describeSheetReadFailure, SheetConfigMissingError } from "@/lib/coaches/sheetReadFailure";

const SHEET_ENV = "INSTRUCTOR_CONTRACT_SHEET_ID";
// 탭 이름에 공백·괄호·콜론이 있어 A1 표기에서 작은따옴표로 감싼다. 바뀌면 INSTRUCTOR_CONTRACT_SHEET_RANGE로 덮어쓴다.
const DEFAULT_RANGE = "'(강사 설문지 : 히스토리 체크용)'!A:Q";

// 열 인덱스(0-base). 시트 헤더 기준: C=계약 발송(모두싸인) · F=최종완료 · J=강의 코스 ID · O=강사명 · Q=강사 이메일.
const COL = { contractSent: 2, contractCompleted: 5, courseId: 9, instructorName: 14, email: 16 } as const;

export interface InstructorContractRecord {
  courseId: string;
  instructorName: string;
  email: string;
  /** 모두싸인 발송됨(C열 TRUE) */
  contractSent: boolean;
  /** 최종완료됨(F열 TRUE) */
  contractCompleted: boolean;
}

/** 시트 값 배열을 계약 레코드로 파싱한다(1행은 헤더라 건너뜀). 코스ID·강사명 둘 다 비면 빈 행으로 보고 버린다. */
export function parseInstructorContractRows(values: string[][]): InstructorContractRecord[] {
  const records: InstructorContractRecord[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const courseId = (row[COL.courseId] ?? "").trim();
    const instructorName = (row[COL.instructorName] ?? "").trim();
    if (!courseId && !instructorName) continue;
    records.push({
      courseId,
      instructorName,
      email: (row[COL.email] ?? "").trim(),
      contractSent: (row[COL.contractSent] ?? "").trim().toUpperCase() === "TRUE",
      contractCompleted: (row[COL.contractCompleted] ?? "").trim().toUpperCase() === "TRUE"
    });
  }
  return records;
}

/** 강사 계약 시트를 읽어 계약 레코드로 돌려준다. 원인이 분류된 읽기 실패 메시지를 던진다. */
export async function readInstructorContractRecords(): Promise<InstructorContractRecord[]> {
  const range = process.env.INSTRUCTOR_CONTRACT_SHEET_RANGE?.trim() || DEFAULT_RANGE;
  const spreadsheetId = process.env.INSTRUCTOR_CONTRACT_SHEET_ID?.trim() || "";
  if (!spreadsheetId) throw new SheetConfigMissingError(SHEET_ENV);
  try {
    const { values } = await readGoogleSpreadsheetRows(spreadsheetId, range);
    return parseInstructorContractRows(values);
  } catch (error) {
    throw describeSheetReadFailure(error, {
      label: "강사 계약 시트",
      sheetEnvName: SHEET_ENV,
      range,
      serviceAccountEmail: readGoogleServiceAccountConfig().serviceAccountEmail
    });
  }
}
