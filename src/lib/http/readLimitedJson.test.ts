import assert from "node:assert/strict";
import { test } from "node:test";
import { readLimitedJson, RequestBodyTooLargeError } from "./readLimitedJson";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/test", { method: "POST", body, headers });
}

test("Content-Length 없이 보낸 2MB 초과 요청을 거절한다", async () => {
  const req = request(JSON.stringify({ ignored: "x".repeat(2_100_000) }));
  assert.equal(req.headers.get("content-length"), null);
  await assert.rejects(readLimitedJson(req, 2_000_000), RequestBodyTooLargeError);
});

test("작은 Content-Length를 보내도 실제 본문 크기로 거절한다", async () => {
  await assert.rejects(readLimitedJson(request('"abcdef"', { "content-length": "1" }), 4), RequestBodyTooLargeError);
});

test("상한과 같은 UTF-8 바이트 수는 허용하고 한 바이트 초과는 거절한다", async () => {
  const body = JSON.stringify({ value: "한글" });
  const bytes = new TextEncoder().encode(body).byteLength;
  assert.deepEqual(await readLimitedJson(request(body), bytes), { value: "한글" });
  await assert.rejects(readLimitedJson(request(body), bytes - 1), RequestBodyTooLargeError);
});

test("헤더가 상한을 넘으면 본문을 읽지 않는다", async () => {
  const req = request('{}', { "content-length": "999" });
  await assert.rejects(readLimitedJson(req, 20), RequestBodyTooLargeError);
});

test("여러 청크의 합계가 상한을 넘으면 업로드를 취소한다", async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { reads += 1; controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const req = { headers: new Headers(), body: stream } as Request;
  await assert.rejects(readLimitedJson(req, 10), RequestBodyTooLargeError);
  assert.equal(cancelled, true);
  assert.equal(reads, 2);
  assert.equal(stream.locked, false);
});

test("UTF-8 문자가 청크 경계에서 잘려도 JSON을 복원한다", async () => {
  const bytes = new TextEncoder().encode('"한"');
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  assert.equal(await readLimitedJson({ headers: new Headers(), body: stream } as Request, bytes.length), "한");
});

test("깨진 JSON은 파싱 오류로 반환한다", async () => {
  await assert.rejects(readLimitedJson(request("{"), 20), SyntaxError);
});
