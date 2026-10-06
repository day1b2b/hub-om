# 남은 범위

이번 API 경계 Task의 구현·합성 검증과 전체 PostgreSQL→MongoDB Initiative의 완료를 구분한다.

1. 다음 구현: 코치 토큰 인증/본인 조회/개인정보 export 경계와 권한·접근 감사. 기존 privateAccess 서비스 검증을 export 이전으로 간주하지 않는다.
2. 이후: 일정/예약/섭외·마스터/복원·OM 배정·외부 sync·staging/import·공지/첨부·활동피드/관리도구·Calendar/health. 전체 목록은 docs/operations/mongodb-runtime-coverage.md.
3. Team 물리삭제 정책 충돌은 현재 failclosed 유지. 사용자에게 선택을 요청하기 전에 실제 삭제 사용처/종속 데이터/기존 보존 정책을 검토하여 구체안을 준비한다. 모든 Team writer의 guard 참여도 출시 gate.
4. 관리 scan 2만행/32MiB 한계 및 이름 검색/정렬의 실제 데이터량 검증. 운영 규모를 확인하지 않은 채 제거 또는 통과로 처리하지 않는다.
5. 운영 리허설: 구성된 Mongo cluster 권한 재확인, 승인된 shadow 복사와 암호화/참조/고유키 대조, 변경 반영, 백업 복원, 최종 입력 중단/전환/실패 복구 계획. 단순 주소 복귀를 신규 Mongo 쓰기 이후 복구로 간주하지 않는다.
6. 생산 selector는 아직 미도입. 전체 경로가 준비되기 전 main auto-deploy·조기 Mongo 선택 금지. 브라우저 초안과 서버 전체 개인정보 보호 완료는 별도 근거 필요.

현재 사용자 추가 입력 없이 1~2 구현·검증을 진행할 수 있다. 실제 권한/운영 중단 등 사용자가 해야 하는 조치가 확인되면 대상과 절차를 한 번에 안내한다.
