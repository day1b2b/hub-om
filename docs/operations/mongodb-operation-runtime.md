# MongoDB 운영 repository 병렬 검증

`MongoOperationRepository`는 기존 `OperationRepository`의 생성·조회·수정·soft-delete·과정 검색·요약을 native driver로 구현한다. **생산 factory는 여전히 PostgreSQL/Prisma를 선택한다.** MongoDB 전환, 이중 쓰기, 캘린더·다른 repository 전환은 포함하지 않는다.

기준 커밋은 `c257b82281b04d591731842674a583998c77a4b4`, 승인된 드라이버는 `mongodb@7.2.0`이다. Prisma schema, SQL migrations, package/lock, 기존 factory와 Prisma repository를 변경하지 않았다. 운영 데이터·실제 키·외부 MongoDB 쓰기는 수행하지 않았다.

## 명시적 연결

일반 요청 처리나 factory에서 준비 함수를 호출하지 않는다. 이미 승인된 **별도 shadow namespace**에 한 번 준비한 후 repository를 직접 생성하는 개발용 진입점만 제공한다.

```ts
import { MongoClient } from "mongodb";
import { prepareMongoOperationStore } from "@/lib/data/mongoOperationStore";
import { MongoOperationRepository } from "@/lib/data/mongoOperationRepository";

// 연결과 승인 범위는 호출자가 명시한다. 환경변수/PG fallback이 없다.
const client = new MongoClient(explicitlyAuthorizedUri);
await client.connect();
const options = {
  client,
  databaseName: "hub_om_shadow_validation",
  namespace: "shadow_explicit_synthetic_run"
};
await prepareMongoOperationStore({
  ...options,
  allowShadowWrites: true,
  processSequenceHighWater: explicitlyVerifiedSourceSequenceHighWater
});
const repository = await MongoOperationRepository.open(options);
// await repository.createOperation(syntheticInput), getOperationById, updateOperation...
await client.close();
```

이 예제는 실행 승인이 아니다. 기존 import namespace를 쓰려면 복사 완료·관계 검증·원본 sequence high-water를 확인하고 import writer를 중지해야 한다. prepare는 collection validator를 설치하고 인덱스·counter를 생성하므로 승인된 shadow에만 실행한다. 잘못된 기존 index 옵션은 자동 삭제/교체하지 않고 실패한다. replica set 또는 sharded transaction 지원, strict/error validator, unique/partial/HMAC index, counter 준비를 `open`에서 검증한다. 외부 관리자에 의한 이후 제약 제거까지 방지하는 보안 경계는 아니다.

## 저장 계약

- `mongoRuntimeContracts.json`은 migration 계약 35모델의 정적 사본이다. 테스트가 schema/DMMF 기반 migration 계약과 전체 비교한다. runtime은 Prisma, DMMF, schema filesystem, migration 도구를 import하지 않는다.
- UUID `_id`, Date, Decimal128, Binary 및 JSON의 DB null/JSON null 구분을 기존 export/import와 보존한다. 정적 사본 변경 시 codec roundtrip 테스트가 필수다.
- 기존 125개 개인정보 정책과 AES-GCM/HMAC 문맥을 그대로 사용한다. 모든 필드·companion이 있는 전체 문서만 인증한다. 잘린 projection, 변조·평문·잘못된 키·누락 HMAC은 조회 실패이며 DTO에는 companion을 내보내지 않는다.
- 서버 validator는 필수 필드·타입·enum·암호문 envelope·개인정보 JSON wrapper·HMAC null 동반 관계를 검증한다. 암호학적 진위와 HMAC 일치 여부는 codec에서 검증한다. validator 자체가 암호문을 인증하지는 않는다.
- 실제 equality 검색은 `MongoOperationStore.findPrivateEqual`이 필드별 HMAC index를 이용하고 반환 전체 문서를 인증한다. 부분검색/정규화·정렬에 필요한 읽기는 **한 번의 후보 조회당 20,000문서 및 32MiB BSON**에서 실패한다. 부분 결과를 성공으로 반환하지 않는다. 복호화된 결과의 합계 메모리나 전체 요청의 모든 조회 합계에 대한 별도 한도는 아니다.
- 목록은 회차·과정·고객사·정확한 고객사/코스ID 라벨·최신 원천을 일괄 조회한다. 최신 원천/과정별 최근 회차는 서버가 전체 문서 1건을 선택하므로 오래된 이력만 많다는 이유로 후보 상한에 걸리지 않는다.

## 트랜잭션과 기존 동작 차이

생성 scope를 `_id`로 하는 `__creation` claim, 고객사, 과정, `__counter` 채번, 회차, 감사가 하나의 snapshot transaction에 포함된다. 같은 scope/내용은 현재 회차를 replay하고, 내용 변경·삭제된 회차는 conflict다. 기존 PostgreSQL에서 가져온 manual-request ID도 새 claim 이전에 확인한다. 이 준비 단계에서 imported 같은 scope가 복수 존재하는 비정상 원천을 자동 병합하지 않는다.

driver의 transient/unknown-commit 재시도를 사용하고, unique upsert 경쟁은 별도 최대 5회 새 transaction에서 재조회한다. transaction 전체 timeout은 30초다. counter는 기존 값·저장된 과정 최대값·명시적 원본 high-water 중 최댓값 이상에서 증가하고 Int32 상한을 넘기지 않는다. rollback된 번호는 재사용할 수 있으므로 PG sequence의 gap 발생 특성과는 다르다.

수정은 최종 `courseId + courseName` 쌍을 한 번 결정하며 label/category/tools와 회차 변경을 같은 transaction에 넣는다. 기존 PG의 순차적 과정 재배정 문제를 복제하지 않는다. 새로운 과정은 원래 과정의 속성을 복사하고, 이미 존재하는 목적 과정은 그 속성을 유지한다. 명시한 category/tools는 목적 과정의 공유 속성을 바꾸며, 옮기기 전 과정의 다른 회차는 보존한다. `courseIdLabel`은 최종 회사+코스ID에 적용한다.

금액 API는 기존 number/null을 받고 Decimal(14,2) 범위와 소수점 두 자리까지 검증한다. 범위 초과·소수점 초과를 암묵적으로 반올림하지 않는다. 날짜 역전도 쓰기 전에 거절한다. PostgreSQL의 잘못된 입력 허용 여부를 재현하지 않는 의도적 엄격화다.

감사는 기존 `activityContext`가 있는 요청만 기록한다. 업무와 같은 transaction이며, 실패하면 업무도 rollback한다. 논리값을 비교해 동일 개인정보의 랜덤 재암호화를 변경으로 기록하지 않는다. 개인정보는 redacted metadata만, 허용 비개인정보는 제한된 값만 포함하며 actor와 changes는 암호화한다. target/field 이름과 enum/date 형식은 기존 SQL 감사와 맞춘다. request 수집·감사 조회 repository 전체를 Mongo로 전환한 것은 아니다.

## 실제 로컬 엔진 재현

검증 서버: macOS arm64 MongoDB **8.0.32**, 단일 노드 replica set. [공식 배포 목록](https://downloads.mongodb.org/current.json)의 SHA-256과 다운로드 파일을 대조했다.

- archive: `https://fastdl.mongodb.org/osx/mongodb-macos-arm64-8.0.32.tgz`
- SHA-256: `f81cb258434d548dca7244d599c82eb339043d8dedd0b1b807870c9d263117f2`

임시 `/tmp/hub-om-mongo-runtime-*` 경로에서 검증한 archive를 해제한 뒤 실행한다. helper는 macOS `/private/tmp`·`lsof`·`ps`를 사용한다. 다른 OS는 이 helper를 그대로 쓰지 않는다. 다운로드나 checksum 검증을 helper가 대신하지 않는다.

```sh
node scripts/check-mongodb-operation-runtime.mjs start --binary /private/tmp/hub-om-mongo-runtime-EXAMPLE/mongodb-macos-arm64-8.0.32/bin/mongod
```

반환된 loopback URI로만 통합 테스트를 실행한다. 새 프로세스의 실제 listener PID를 확인한 후 replica set을 초기화한다. 테스트는 랜덤 DB/namespace와 임시 키를 자체 생성하고 자신이 만든 DB만 정리한다. URI 미지정 시 명시적으로 skip하며 원격 URI·credentials·기존 DB명을 거부한다.

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  MONGODB_RUNTIME_TEST_URI='mongodb://127.0.0.1:RETURNED_PORT/?replicaSet=hubOmSynthetic&directConnection=true' \
  node --experimental-strip-types --experimental-test-module-mocks \
  --experimental-loader ./scripts/ts-loader.mjs \
  --test src/lib/data/mongoOperationRepository.integration.test.ts
node scripts/check-mongodb-operation-runtime.mjs stop --state /private/tmp/hub-om-mongo-runtime-RETURNED/owner.json
```

종료 helper는 자신이 기록한 PID·binary·dbpath·loopback binding이 모두 일치할 때만 종료한다. 임시 파일은 증거 확인을 위해 남긴다. 공유 Docker, 기존 DB, 기존 mongod를 시작·수정·종료하지 않는다.

## 검증과 남은 전환 범위

실제 로컬 서버에서 생성→조회→수정→replay, 같은/다른 내용의 동시 요청, 채번, 동시 수정, 회차 감사 단계에서의 전체 rollback, soft-delete 후 재전송 거절, HMAC 조회, 평문/누락 companion 서버 거절, null-distinct unique, 잘못된 index/validator readiness 거절을 검증한다. 후보 20,000/20,001건, 24/36MiB, 과거 source 20,001개, 무관 label 20,001개도 포함한다.

전체 명령·결과·독립 리뷰는 `.claude/plans/mongodb-operation-runtime/`에 기록한다. 로컬 실제 엔진 결과는 **외부 MongoDB의 권한·TLS·백업·복구·성능·배포 설정 검증을 대신하지 않는다.** 다른 repository, background jobs, imports, audit feed, calendar, 실제 업무 데이터 동등성, 동결 시점 sequence 재확인, 전환/복구 rehearsal은 남아 있다. 현재 결과만으로 production factory를 교체하면 안 된다.

설계 근거: MongoDB [Node transaction 문서](https://www.mongodb.com/docs/drivers/node/v6.18/crud/transactions/)의 동일 transaction 내 순차 실행/재시도 규칙과 [partial unique index](https://www.mongodb.com/docs/v8.0/core/index-partial/) 규칙을 적용했다. 사용한 driver 7.2.0의 설치된 타입/API 및 실제 MongoDB 엔진에서도 검증했다.
