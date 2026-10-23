import { GoogleSheetReadError } from "./googleServiceAccount";

/**
 * 동기화 화면에 그대로 보여줄 수 있는 시트 읽기 실패 메시지.
 * 원천 응답 본문은 넣지 않고(시트 내용이 섞일 수 있음), 원인 종류·설정 이름·범위만 쓴다.
 */
export class SheetSourceReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetSourceReadError";
  }
}

export class SheetConfigMissingError extends Error {
  readonly envName: string;
  constructor(envName: string) {
    super(`${envName} env가 필요합니다.`);
    this.name = "SheetConfigMissingError";
    this.envName = envName;
  }
}

export interface SheetReadContext {
  /** 화면에 쓰는 이름. 예: "계약 시트" */
  label: string;
  /** 시트 ID를 정하는 환경변수 이름 */
  sheetEnvName: string;
  range: string;
  serviceAccountEmail?: string;
}

export function describeSheetReadFailure(error: unknown, context: SheetReadContext): SheetSourceReadError {
  const lead = `${context.label}를 읽을 수 없습니다.`;
  if (error instanceof SheetConfigMissingError) {
    return new SheetSourceReadError(`${lead} 시트 ID 설정(${error.envName})이 없습니다.`);
  }
  if (!(error instanceof GoogleSheetReadError)) {
    return new SheetSourceReadError(`${lead} 구글 시트에 연결하지 못했습니다.`);
  }
  switch (error.kind) {
    case "missing_credentials":
      return new SheetSourceReadError(`${lead} 구글 서비스 계정 설정(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)이 없습니다.`);
    case "auth_failed":
      return new SheetSourceReadError(`${lead} 구글 서비스 계정 인증에 실패했습니다${error.code ? `(${error.code})` : ""}. 서비스 계정 키 값을 확인해 주세요.`);
    case "forbidden": {
      const account = context.serviceAccountEmail ? `서비스 계정(${context.serviceAccountEmail})` : "서비스 계정";
      return new SheetSourceReadError(`${lead} ${account}에 이 시트 접근 권한이 없습니다. 시트를 이 계정에 공유해 주세요.`);
    }
    case "not_found":
      return new SheetSourceReadError(`${lead} 시트를 찾을 수 없습니다. 시트 ID 설정(${context.sheetEnvName})을 확인해 주세요.`);
    case "bad_range":
      return new SheetSourceReadError(`${lead} 탭이나 범위를 찾을 수 없습니다(${context.range}). 탭 이름이 바뀌었는지 확인해 주세요.`);
    default:
      return new SheetSourceReadError(`${lead} 구글 시트가 오류를 돌려줬습니다${error.status ? `(HTTP ${error.status})` : ""}.`);
  }
}
