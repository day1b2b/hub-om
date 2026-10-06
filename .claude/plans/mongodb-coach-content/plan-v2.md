# 실행 계획 v2

v1 및 독립 critic/architect 검토 반영. 기존 정책을 보존하는 저장 경계 작업이며 운영 전환은 범위 밖이다.

1. [Core] context 자체가 없으면 PG 기본, 명시 scope에 필수 서비스가 없으면 실패한다. notes/read/feed/month는 coachContent, 페이지 삭제수는 coachAdmin.countDeletedCoaches로 연결한다. logProfileEdit/logReviewEdit는 기존 PG helper로 남겨 scope guard를 유지한다.
2. [Shell] interface/PG/factory/routes/page를 연결한다. 기존 e1b9749 route/helper의 조건을 독립 비교 기준으로 삼고 schema/새dependency는 변경하지 않는다.
3. [Core] Mongo 메모 writer는 scheduling guard 획득 후 부모/대상을 판정한다. catalog를 나중에 획득하지 않는다. note/history/audit 동일 transaction. 생성/수정/삭제/토글과 purge 양방향 경합에서 고아·실패잔여·이력중복을 차단한다.
4. [Core] 피드 각 source의 최신300을 DB에서 제한하고 기존 개인정보 codec으로 복호화·DTO화한다. status는 ACTIVE/미삭제 및 월 접근 로그로 계산한다. count는 목록 전체 복호화 없이 처리한다. companion 응답 노출 금지.
5. [Check] 실제 loopback PG17와 Mongo8 replica set, env-i 및 랜덤 임시 키/합성 데이터로 검증한다. 고정fixture는 엄격비교; 비결정 ID/시간만 정규화. 동률300경계·collation·기존PG동시성 한계는 명시하고 신규PG정책변경으로 확대하지 않는다.
6. [Check] 실제 auth/withActivity/관리 page를 실행한다. 이력 및 감사 후행 실패·동시토글·purge 경합·오류/저장 평문·scope 누락·readiness 검사와 전체 회귀를 실행한다. 환경 승인은 제한을 존중하고 검증 명령을 가능한 묶는다.
7. [Check] 독립 실행 리뷰의 유효 지적 수정 후 영향 검사를 실행한다. coverage/macro/manifest/review/handoff 갱신, feature commit/push/원격 SHA확인. 소유 합성 DB/process만 정리, 사용자 요청 binary는 유지한다. 총괄 통합은 별도 담당.

수락 기준은 validation-v2에 연결한다. 스킵·미실행을 PASS 처리하지 않는다. 실제 OAuth/운영Atlas/데이터복사/복구리허설/브라우저초안 암호화는 미완료로 남긴다.
