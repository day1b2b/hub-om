# MongoDB 운영 상세 보조 API runtime

운영 상세의 Drive 후보·폴더 조회, 선택 항목 적용, 원천 토론 새로고침 API는 새 저장소를 만들지 않고 검증된 `MongoOperationWriteRuntime`의 `operations`와 `requestActivity`를 사용한다. Drive 적용은 Calendar 반영 wrapper를 통과하며, 나머지 조회는 같은 operation snapshot과 감사 namespace를 사용한다. 생산 factory와 기본 PostgreSQL backend는 바꾸지 않았다.

로컬 MongoDB replica set과 합성 Calendar remote에서 네 실제 handler를 실행한다. Drive 적용으로 지역을 바꾼 뒤 Calendar PATCH의 장소와 이벤트 수가 맞는지, Drive 서비스 계정이 없는 상태에서 후보·폴더 조회가 외부 fetch 없이 명시적 issue를 반환하는지, 외부 토론 원천이 없는 상태에서 새로고침이 disabled 결과를 반환하는지 확인한다. 테스트는 관련 Drive·Calendar reader·Slack·메일·사용자 source module 변수를 명시적으로 비워 외부 원천 미설정 조건을 고정한다. 네 요청의 route·method·status·암호화 actor 감사도 기존 운영 쓰기 검증에 포함한다.

이번 범위는 저장소 전환 경계와 외부 원천 미설정 의미를 검증한다. 실제 Google Drive·Slack·메일 원천, 브라우저 상호작용, production selector, 운영 데이터·namespace, A/B 백업·복원·복사·최종 전환은 검증하지 않았다.
