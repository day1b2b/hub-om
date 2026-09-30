# MongoDB 공통 개요 화면 runtime

`/dashboard`, `/me`, `/company-wiki`, `/resources`의 서버 조회를 하나의 명시 Mongo shadow runtime으로 조립한다. 네 화면이 공유하는 `operations`, `teamMembers`, `teamUsers`, `omRequests`는 같은 borrowed client/database/namespace를 사용한다. 생산 기본 backend와 repository factory의 PostgreSQL fallback은 바꾸지 않았다.

`prepareMongoOverviewPagesRuntime`은 완전히 빈 합성 namespace만 준비한다. 해당 namespace 접두사의 collection이 하나라도 있으면 알려지지 않은 legacy 이름이어도 자동 생성·수리하지 않고 `openMongoOverviewPagesRuntime`의 read-only readiness 검사로 넘긴다. 준비와 open 모두 명시적인 `allowShadowWrites: true`를 요구하며, 등록한 repository 묶음은 실행 중 잠가 다른 namespace의 port나 불완전한 묶음으로 교체하지 못하게 한다.

로컬 MongoDB 8.0.30 replica set에서 네 실제 page 함수를 실행해 운영, 담당자, 배정 대기 OM 요청, 회사 위키와 자료실 데이터를 확인했다. 페이지 조회 전후 전체 Mongo snapshot은 같았고 PostgreSQL adapter와 pool은 실패 tripwire로 두었다. 외부 Calendar 원천은 disabled 합성 결과를 명시 주입했으며 실제 Google·Notion·Slack·메일에는 접근하지 않았다.

이번 범위는 네 화면의 초기 서버 조회 조립이다. 브라우저 상호작용, 외부 원천 활성화, production selector, 운영 namespace와 실제 데이터는 포함하지 않는다. 실제 A/B 백업·각 복원·복사·최종 전환과 `dev`→`main` 병합 조건도 아직 충족하지 않았다.
