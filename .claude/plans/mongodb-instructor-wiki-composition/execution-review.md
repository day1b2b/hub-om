# 강사 위키 쓰기 composition 실행 리뷰

- 범위: 강사 위키 메모 저장과 수동 Notion 강사 연결 API
- 선택: 기존 공개 화면 runtime을 확장하지 않고 `instructorNote`·`requestActivity`만 노출하는 전용 runtime과 exact selector를 추가했다.
- 보존: PostgreSQL 기본값, workspace/admin 권한, 이름 기준 부분 병합, 페이지 ID 기반 연결, 일반화한 오류 응답
- 검증: selector 단위 6건, 실제 Mongo route 1건, 전체 테스트 1526개 중 1354 pass·172 skip·0 fail, typecheck 통과
- 실제 Mongo 확인: 관리자와 일반 workspace 사용자의 저장, 일반 사용자의 연결 403·저장 불변, 비인증 redirect, 업무/요청 감사, raw 평문 비노출, PostgreSQL 접근 0건, 부분 namespace 전후 전체 snapshot 동일
- 외부 원천: 해당 API는 외부 Notion 호출을 하지 않아 합성 HTTP port가 필요하지 않았다.
- 미완료: production selector 설정, 운영 데이터 복사, A/B 백업·복원, 최종 전환
