/**
 * 실행 환경(서버/브라우저)의 로컬 시간대와 무관하게, 한국(Asia/Seoul) 기준 "오늘" 날짜를
 * 나타내는 Date를 만든다. 프로덕션 컨테이너가 UTC로 도는데 브라우저는 KST라, 자정~오전 9시
 * 사이엔 `new Date()`의 연/월/일이 서버와 클라이언트에서 서로 달라져 대시보드 진행중/예정/완료
 * 같은 날짜 기반 텍스트가 SSR과 하이드레이션 사이에 어긋나는 문제(React #418)가 있었다.
 */
export function getSeoulToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return new Date(get("year"), get("month") - 1, get("day"));
}
