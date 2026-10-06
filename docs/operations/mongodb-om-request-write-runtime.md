# MongoDB OM 요청 쓰기 runtime

OM 요청 생성·수정·삭제와 전체 회차 배정 API에 필요한 `omRequests`, Calendar-aware `operations`, `omAssignment`, `teamUsers`, `teamMembers`, `requestActivity`, Calendar persistence·lock을 하나의 명시 Mongo shadow runtime으로 조립한다. 맞춤 도구, 접수 알림, 배정 Calendar와 배정 알림은 호출자가 명시적으로 제공한 port만 사용한다. 생산 기본 backend와 PostgreSQL fallback은 바꾸지 않았다.

`prepareMongoOmRequestWriteRuntime`은 완전히 빈 합성 namespace만 준비한다. 해당 namespace 접두사의 collection이 하나라도 있으면 알려지지 않은 legacy 이름이어도 자동 생성·수리하지 않고 read-only readiness 검사로 넘긴다. 등록한 전체 repository·effect 묶음은 실행 중 잠가 다른 namespace나 누락 port로 바꿔 끼우지 못하게 한다.

로컬 MongoDB 8.0.30 replica set에서 실제 API handler로 요청 생성, 작성자 수정, 파트 관리자 배정 미리보기·확정, 관리자 삭제를 실행했다. 운영 자동 연결 시 합성 Calendar 이벤트와 같은 namespace의 매핑이 생성되는지 확인했다. 모든 handler의 request audit와 맞춤 도구·접수/배정 알림 payload를 검증했고, 네 effect port의 실패가 핵심 저장과 성공 응답을 되돌리지 않으며 비공개 오류 표식을 로그에 남기지 않는 것도 확인했다. 저장 snapshot에는 삭제 전에도 합성 이름·이메일·강사·링크·장소·요청사항·배정자 평문이 남지 않았고 PostgreSQL adapter와 pool은 실패 tripwire로 두었다.

이번 범위는 명시 shadow runtime과 합성 effect 검증이다. 실제 Slack·Google Calendar, production selector, 운영 namespace와 실제 데이터에는 접근하지 않았다. 실제 A/B 백업·각 복원·복사·최종 전환과 `dev`→`main` 병합 조건도 아직 충족하지 않았다.
