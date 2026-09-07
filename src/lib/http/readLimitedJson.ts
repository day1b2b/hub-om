export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the byte limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

/** 헤더가 없거나 잘못돼도 실제 읽은 바이트 수로 중단한다. 초과한 본문은 JSON으로 파싱하지 않는다. */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredBytes = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    void request.body?.cancel().catch(() => {});
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        // 취소 완료를 기다리면 응답하지 않는 업로드가 413 반환까지 막을 수 있다.
        void reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}
