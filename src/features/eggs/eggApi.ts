/** 에그 API 호출 결과. 화면은 ok/error만 보고 피드백 문구를 정한다. */
export interface EggApiResult {
  ok: boolean;
  error?: string;
}

export async function callEggApi(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown
): Promise<EggApiResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => ({}))) as EggApiResult;
    if (!response.ok || !payload.ok) {
      return { ok: false, error: payload.error ?? "요청을 처리하지 못했습니다." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "요청을 보내지 못했습니다. 네트워크 상태를 확인해주세요." };
  }
}
