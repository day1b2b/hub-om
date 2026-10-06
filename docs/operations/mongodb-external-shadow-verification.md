# 외부 MongoDB shadow 검증

사용자가 `hub-om-shadow-validation` 권한 설정 후 검증 진행을 승인했다. 이 문서는 실제 운영 데이터 이관 결과가 아니라 **외부 대상에서 실행한 합성 데이터 검증**을 기록한다.

## 범위와 보호 경계

- DB: `hub-om-shadow-validation`. URI 기본 DB는 사용하지 않는다.
- 로그인 계정의 두 DB(`hub-om-shadow-validation`, `hub-om`)에 `readWrite`와 `dbAdmin` 확인. 운영용 `hub-om`에는 쓰지 않았다.
- PostgreSQL 조회·수정, 실제 개인정보/암호화 키, 생산 factory/배포 변경은 없다.
- URI만 별도 로딩하고 출력하지 않았다. 도구는 임시 PII 키와 합성 fixture를 생성한다.
- 매 실행마다 무작위 namespace를 만들고, 생성에 성공한 컬렉션만 정리한다. 지정 DB 자체는 삭제하지 않는다.

## 확인 결과

1. 권한: listCollections/createCollection/collMod/insert/update/read 성공. transaction commit 및 abort 후 원복 확인. 임시 컬렉션 정리 성공.
2. 연결: TLS 활성화, invalid certificate/hostname 허용 및 tlsInsecure 모두 false. replica-set/session 지원 확인. 이는 접속 옵션 및 handshake 확인이며 보안 구성 전체 감사는 아니다.
3. 35모델 합성 복사: `check-mongodb-shadow-synthetic.ts --allow-synthetic-shadow-writes --cleanup-synthetic-db`를 명시 DB로 실행. 35모델 각1행, BSON roundtrip, insert-only 동일 내용 재시도, 모델 관계, transaction rollback 통과. 생성한36컬렉션 정리 성공, DB 자체는 보존.

35모델 도구 결과:

```json
{"syntheticOnly":true,"modelsVerified":35,"rowsVerified":35,"bsonRoundtripVerified":true,"insertOnlyRetryVerified":true,"referencesVerified":true,"transactionRollbackVerified":true,"syntheticCollectionsCleaned":true,"syntheticDatabaseCleaned":false,"readyForCutover":false}
```

## 외부 운영 repository 결과

`check-mongodb-operation-shadow.ts --allow-synthetic-shadow-writes --cleanup-owned-collections`도 같은 명시 DB에서 성공했다. 준비 validator/index, 같은 scope6요청→1회 생성, 등록→조회→수정→replay, 개인정보 암호화·HMAC 검색·감사 인증, 다른 fingerprint 동시 conflict, soft-delete replay conflict, 회차 감사 실패 시 전체 transaction rollback의7항목 통과. 합성13행·생성9컬렉션, 정리 성공·잔여0. 운영용 DB 쓰기는 없다.

```json
{"ok":true,"checks":["validators_indexes_transactions_ready","same_scope_six_requests_one_creation","create_read_update_replay","encrypted_storage_hmac_authenticated_audit","concurrent_fingerprint_conflict","soft_delete_replay_conflict","late_audit_full_transaction_rollback"],"syntheticRows":13,"createdCollections":9,"cleanupVerified":true,"ownedRemaining":0,"cutoverAuthorized":false}
```

## 재현과 코드 검토

URI는 보안 경로에서 실행 프로세스에만 공급한다. `.env` 전체를 자동 로딩하지 않고 `MONGODB_SHADOW_DATABASE=hub-om-shadow-validation`을 명시한다. PII 키는 도구 내부에서 새로 생성한다.

```sh
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/check-mongodb-operation-shadow.ts \
  --allow-synthetic-shadow-writes --cleanup-owned-collections
```

독립 reviewer sql_review의 두 지적을 실행 전에 보완했다. 모든 동시 쓰기를 allSettled로 기다린 후 cleanup하고, 정확한 임시 이름의 사전 부재 검사 및 무작위 소유 토큰 생성 옵션으로 기존 컬렉션 오인을 막는다. 정확한 지정 DB·필수2플래그·소유9컬렉션에 한정해 검토 수락됐다. lint 및 TypeScript 검사 통과. 기존 local 통합 테스트의 loopback 제한은 변경하지 않았다.

네트워크 응답 유실이 발생한 실패 실행에서 `cleanupVerified`는 추적된 owned 목록 정리만 의미한다. 실제 잔존 컬렉션이 전혀 없다는 증명으로 확대하지 않는다. 미확인 컬렉션은 자동 삭제하지 않으며, 정리 실패 때 출력되는 임시 컬렉션명으로 별도 확인한다.

## 남은 전환 gate

실제 PostgreSQL snapshot→암호화 export/import→건수/내용/관계 대조, 실제 키 보관·복구 체계, 전체 서비스의 Mongo repository 연결, 생산규모 성능, 다중노드 장애·불명확한 commit, backup/restore 및 역이전 rehearsal은 별도다. 이번 결과로 production factory를 바꾸거나 실제 데이터 이전 완료를 선언하지 않는다.
