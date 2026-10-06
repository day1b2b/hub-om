# MongoDB OM 요청 화면 runtime

`/om-request`, `/om-request/manage`, `/om-request/manage/[id]`, 수정 화면과 완료 화면의 서버 조회를 기존 `MongoOperationPagesRuntime`에서 실행한다. 이 runtime은 화면들이 공유하는 `operations`, `teamUsers`, `teamMembers`, `instructorNote`, `omRequests`와 명시적으로 빌린 `omCustomTools`를 이미 같은 client/database/namespace로 잠근다. 별도 중복 runtime은 만들지 않았고 생산 기본 backend와 PostgreSQL fallback도 바꾸지 않았다.

로컬 MongoDB 8.0.30 replica set에서 다섯 실제 page 함수를 실행했다. 등록 화면의 팀·기업·강사·맞춤 도구 후보, 관리 목록, 상세 화면의 배정 권한·담당자 명단·관리자/작성자 권한, 수정 초기값과 완료 내용을 확인했다. 완료 화면은 workspace 인증 전에 요청을 읽지 않으며 비인증 접근의 Mongo command가 0인지 검증했다. 조회 전후 전체 Mongo snapshot은 같았고 PostgreSQL adapter와 pool은 실패 tripwire로 두었다. 다른 namespace 중첩과 일부 port 교체, 알려지지 않은 legacy 부분 namespace의 자동 수리도 차단했다.

이번 범위는 다섯 화면의 초기 서버 조회다. OM 요청 생성·수정·삭제 API와 전체 배정 API는 이미 별도 repository 경계로 구현됐지만 이 단위의 실제 handler 조립 범위에는 포함하지 않는다. 브라우저 상호작용, 실제 Slack·Calendar, production selector, 운영 데이터 이전·복원·최종 전환과 `dev`→`main`은 미완료다.
