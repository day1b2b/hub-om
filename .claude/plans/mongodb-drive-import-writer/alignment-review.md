# 정합 검토

결론: update_next_task. 이번 범위는 기능 개선 없이 기존 Drive CLI 이력 쓰기의 저장/원천 경계를 전환하는 사용자 목표에 부합한다. Level3/R1~R6 6/6 선정은 적정했다. 현재 원본이 실행 불가한 schema를 허위 oracle로 사용하지 않고 역사 prefix 정상·중간 default 실패·현재 guard 차단을 분리했다.

개발·검증은 완료했고 총괄 통합 상태는 integration-review를 따른다. 다음 작은 수직 단위는 health 명시 조회 경계다. health는 현재 PG SELECT 1을 직접 호출하므로 명시 Mongo context에서도 올바른 저장소 상태를 확인하도록 분리할 필요가 있다. 관리자 백업과 실제 복원·전체 앱 조립은 별도 작업으로 유지한다.

전체 macro를 완료로 바꾸지 않는다. 기본 PG, 실백업증거0, 실제 원천/개인정보 정책 검토/운영 collation·TZ/활성 CLI·예약·배포/전체 앱/실복사·복원·최종 전환의 미완료와 dev→main 조건 미충족을 유지한다. 사용자 workspace·main/dev·운영·키/env·자동화 설정 변경0. PAUSED 인계를 자동 재개하지 않는다.
