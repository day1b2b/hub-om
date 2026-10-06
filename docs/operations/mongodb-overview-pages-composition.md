# 공통 개요 화면 Mongo composition

대시보드·내 업무·회사 위키·리소스 화면에 `OVERVIEW_PAGES_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 overview-pages runtime을 open-only로 연다. 네 화면은 operations·teamMembers·teamUsers·omRequests 저장소를 같은 잠금 scope에서 사용하고, 요청 중 collection·validator·index를 준비하거나 자동 수리하지 않는다.

실제 MongoDB 8.0.30에서 네 화면을 composition을 통해 직접 렌더링했다. PostgreSQL 접근은 0건이었고, 조회 전후 collection 정의·validator/options·index·행 전체가 같았다. 부분 namespace도 동일 저장 상태를 보존한 채 고정 오류로 거부했다. 기존 인증·팀 범위·404/redirect와 합성 source 대역은 유지된다.

운영 selector·실데이터·브라우저 전체 흐름·A/B 백업과 복원·복사·최종 전환은 미완료다.
