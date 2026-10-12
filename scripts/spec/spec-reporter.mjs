// node:test 리포터: 테스트 결과를 한 줄짜리 JSON으로 남겨 기획서 상태표 생성기가 읽게 한다.
export default async function* specReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    if (event.data.details?.type === "suite") continue;
    yield JSON.stringify({ name: event.data.name, file: event.data.file ?? "", passed: event.type === "test:pass", todo: event.data.todo !== undefined && event.data.todo !== false }) + "\n";
  }
}
