# MongoDB 변경 내역 runtime

`/changes` 화면이 호출하는 활동 조회·콘텐츠 피드·코치 메모 수정·코치 투입 평가 수정 API를 요청 감사와 같은 명시 Mongo shadow runtime으로 조립한다. 기존 인증·응답·업무 감사 계약과 생산 기본 PostgreSQL을 유지한다.

## 포함 포트

- `activityReads`
- `coachContent`
- `coachEngagement`
- `requestActivity`

네 포트는 호출자가 빌려준 같은 `MongoClient`, database, namespace를 사용한다. 메모와 평가는 기존 업무 감사와 요청 감사를 각각 남기며, 관리자 활동 GET은 기존 route 정책대로 요청 감사 대상이 아니다.

## 준비와 재실행

`prepareMongoChangesRuntime`은 정확한 namespace에 알려진 runtime collection이 하나도 없는 새 shadow에서만 request audit, engagement, content, activity-read 순서로 validator·index·guard를 준비한다.

- 준비된 namespace는 mutation 없이 네 repository의 전체 readiness를 확인한다.
- 부분 준비·다른 runtime 모델·오래된 정책이 있으면 자동 수리·삭제하지 않고 고정 오류로 실패한다.
- 준비 도중 중단되어 일부 guard와 collection이 생긴 namespace도 재실행에서 수정하지 않는다.
- 등록된 runtime 객체에서 포트를 빼거나 다른 runtime의 포트를 섞으면 callback 전에 차단한다.
- `openMongoChangesRuntime`은 준비나 client 종료를 하지 않는다.

## 확인한 범위

새 로컬 MongoDB 8.0.30 replica set과 합성 키·데이터에서 실제 API handler를 통해 다음을 확인했다.

- 관리자 콘텐츠 피드에 코치 메모와 투입 평가가 함께 노출됨
- 코치 메모와 투입 평가 수정 응답·복호화 저장값 유지
- 각 요청의 route·status·actor와 업무 변경의 request ID·target ID 연결
- 활동 조회에서 두 업무 변경을 확인하고, 관리자 활동 GET의 요청 감사 제외 유지
- 암호화 저장 문서에 메모·평가·관리자 식별 문자열 평문이 남지 않음
- 준비된 namespace 재실행과 open의 mutation 0
- 실제 준비 중단 namespace의 재실행 거부·mutation 0·snapshot 불변
- 포트 누락·runtime 혼합·중첩 전환을 callback 전에 차단
- PostgreSQL 접근 0과 borrowed client 유지

`/changes` 서버 페이지 자체는 인증과 client shell만 담당하며 데이터 호출은 브라우저의 네 API 요청에서 발생한다. 따라서 이번 검증은 실제 네 handler의 저장 경계 조립 증거이며 브라우저 전체 흐름 검증은 아니다. production selector·전체 Next 요청 구성·운영 namespace·부하·실제 데이터 이전·백업·복원·최종 전환은 확인하지 않았다.
