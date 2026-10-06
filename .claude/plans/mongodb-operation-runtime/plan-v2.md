# Plan v2

Changelog: 독립 sql_review 지적을 반영. prepare에는 명시적 source processSeq high-water 입력이 필수이며 기존 counter 및 Course 최대값과 max로 초기화한다. counter는 transaction에서 증가하며 Int32 상한을 거절한다. driver withTransaction transient/commit 재시도와 별도로 duplicate-key만 최대 5회 transaction 재시도한다. 준비된 인덱스 key/unique/partial와 validator/strict/error 옵션을 비교하여 불일치 시 거절한다. 검색 20,000행+32MiB 유지, audit는 복호화 논리값 비교로 같은 개인정보 재암호화 노이즈를 제거한다. 실제 Mongo 서버 수락 미완료이면 운영 전환 gate를 닫는다.

핵심 난이도: PG lock/sequence/trigger와 암호화 proxy가 보장하던 의미를 Mongo transaction 및 고유 인덱스로 재현해야 한다.

1. [Core] migration 계약과 동등한 정적 runtime codec. 모든 field와 companion을 검증하고 누락/변조/평문 PII는 거부한다. plaintext 입력은 암호화, BSON Date/Decimal/Binary는 무손실 변환. migration roundtrip 대조로 수락.
2. [Core] 명시적 Mongo client/database/collection prefix로만 repository 생성. PG factory는 수정하지 않는다. 생성은 transaction 내 scope claim→company/course upsert→counter→session→audit 순서. 같은 scope/같은 fingerprint는 기존 회차, 다른 fingerprint/삭제된 회차는 conflict. duplicate/write conflict는 제한 재시도, 중간 실패는 rollback. counter는 import된 최대값 및 명시적 high-water 이상에서 원자 증가.
3. [Core] 조회는 암호화 해제 후 기존 DTO/lookup/summary 의미와 순서 보존. 개인정보 검색 후보 20,000 초과는 실패. 수정은 최종 courseId+courseName 쌍으로 재배정하고 label/category/tools를 최종 과정에 적용하며 모든 관련 변경/audit를 같은 transaction에 포함한다. 삭제는 soft-delete.
4. [Core] audit에는 기존 metadata 정책을 적용하고 개인정보 값은 저장하지 않는다. actor는 암호화. unique/partial/null-distinct indexes 및 strict schema validators를 생성하고 runtime 준비 확인을 fail-closed로 수행한다.
5. [Check] 합성 시나리오 생성→조회→수정→replay, 충돌/삭제 replay, 동시 동일/상이 payload, sequence, audit rollback, tamper/projection, 잘못된 date/money를 테스트한다. 로컬 실제 replica set 가능 시 서버 검증, 불가 시 gap 명시. 전체 test/lint/typecheck/build.
6. [Shell] 독립 리뷰→보완→검증 기록 및 local commit. 원격 push 금지.

대안: Prisma API 흉내 adapter는 기존 코드 재사용이 쉽지만 Mongo 원자성/암호화 정책이 숨고 불필요한 API surface가 커진다. native repository 및 순수 mapping 재사용을 선택한다. PG factory 교체는 split-DB 위험과 미승인 cutover 때문에 제외한다.
