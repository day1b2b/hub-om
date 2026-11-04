// 모두싸인 공개 API(읽기 전용) 클라이언트. 문서 목록만 읽는다 — 서명 요청·재발송 같은 쓰기는 범위 밖.
// 인증 = Basic base64("이메일:API Key")(https://developers.modusign.co.kr/docs/api-key로-요청하기).
// 키는 행정·계약팀(최고관리자)이 모두싸인 콘솔에서 발급하고, Coolify env로만 넣는다.
// 목록 응답에 participants·signings·currentSigningOrder가 이미 들어 있어 문서 상세는 따로 부르지 않는다.

const BASE_URL = "https://api.modusign.co.kr";
const PAGE_LIMIT = 100;
// GET /documents는 고비용 API(분당 150·초당 5)라 페이지 사이를 띄운다.
const PAGE_DELAY_MS = 300;

export interface ModusignParticipant {
  id: string;
  type: string;
  name?: string;
  signingOrder?: number;
  signingMethod?: { type?: string; value?: string };
}

export interface ModusignDocument {
  id: string;
  title: string;
  /** ON_GOING · COMPLETED · ABORTED · DRAFT 등 */
  status: string;
  createdAt?: string;
  updatedAt?: string;
  currentSigningOrder?: number;
  participants?: ModusignParticipant[];
  signings?: { participantId: string; signedAt?: string }[];
  metadatas?: { key: string; value: string }[];
}

export interface ModusignConfig {
  email: string;
  apiKey: string;
}

/** env에서 모두싸인 자격을 읽는다. 둘 중 하나라도 비면 null(연동 꺼짐 — 시트 상태만 보인다). */
export function readModusignConfig(env: NodeJS.ProcessEnv = process.env): ModusignConfig | null {
  const email = env.MODUSIGN_API_EMAIL?.trim() ?? "";
  const apiKey = env.MODUSIGN_API_KEY?.trim() ?? "";
  return email && apiKey ? { email, apiKey } : null;
}

/** filter 식 안의 문자열 리터럴. 작은따옴표는 두 번 써서 이스케이프한다(OData 규칙). */
export function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class ModusignRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`모두싸인 문서 목록을 읽지 못했습니다(HTTP ${status}).`);
    this.status = status;
  }
}

type FetchLike = (input: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface ListOptions {
  /** OData 식 예: contains(title, '(B2B)') and createdAt ge '2026-05-01T00:00:00+09:00' */
  filter: string;
  /** 안전 상한(페이지 수). 넘으면 거기서 멈춘다. */
  maxPages?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

/** filter에 맞는 문서를 최신 생성순으로 끝까지(최대 maxPages) 읽는다. */
export async function listModusignDocuments(config: ModusignConfig, options: ListOptions): Promise<ModusignDocument[]> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxPages = options.maxPages ?? 30;
  const authorization = `Basic ${Buffer.from(`${config.email}:${config.apiKey}`).toString("base64")}`;
  const documents: ModusignDocument[] = [];

  for (let page = 0; page < maxPages; page++) {
    if (page > 0) await sleep(PAGE_DELAY_MS);
    const params = new URLSearchParams({
      filter: options.filter,
      limit: String(PAGE_LIMIT),
      offset: String(page * PAGE_LIMIT),
      orderBy: "createdAt desc"
    });
    const response = await fetchImpl(`${BASE_URL}/documents?${params.toString()}`, {
      headers: { accept: "application/json", authorization }
    });
    if (!response.ok) throw new ModusignRequestError(response.status);
    const payload = (await response.json()) as { count?: number; documents?: ModusignDocument[] };
    const batch = Array.isArray(payload.documents) ? payload.documents : [];
    documents.push(...batch);
    if (batch.length < PAGE_LIMIT || (typeof payload.count === "number" && documents.length >= payload.count)) break;
  }
  return documents;
}
