# Mongo 코치 포털 runtime 계획 v1

코치 토큰 본인 조회와 월별 일정 GET/PUT, 요청 감사를 같은 등록·잠금 runtime으로 조립한다. 기존 토큰·일정 동시성·감사·오류 계약과 생산 기본 PostgreSQL을 유지한다.
