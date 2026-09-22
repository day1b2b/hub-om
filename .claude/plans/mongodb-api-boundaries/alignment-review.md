# 상위 목표 정렬

판정: update_next_task. 기존 PostgreSQL 운영 유지, 별도 Mongo 암호화 검증 후 전환이라는 목표 유지.

대안: 즉시 환경 selector를 붙여 부분 전환하거나, 명시 context로 실제 handler/권한/감사를 먼저 검증할 수 있었다. 전자는 미전환 PG/Calendar 경로와 혼합 쓰기를 유발하므로 후자를 채택했다. 비용은 도메인별 경계 구현과 추가 검증이며, 이 단계를 운영 전환 완료로 보고하지 않는 것이 실패 방지 조건이다.

이번 결과는 단독 repository에서 실제 handler 경계로 진전했다. 요청 로그 best-effort와 개인정보 접근 감사 failclosed를 구분하며 업무 변경 감사는 원자적이다. OAuth 자체·생산 UI·실데이터·전체 backend 선택은 범위 밖이다.

다음 Task는 코치 토큰/본인/개인정보 export 연결 준비. 나머지 runtime/운영 리허설은 진행 중이다. 현재 사용자에게 새 키나 DB 설정을 요구할 근거는 없다.
