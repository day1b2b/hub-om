# 코치 링크 토큰 재발급 저장소

코치 토큰 재발급 API의 기존 workspace 세션 확인과 성공 응답 `{ ok: true, accessToken }`은 유지한다. 저장소 호출만 `CoachTokenRotationRepository`와 요청별 `coachTokenRotation` context로 분리했다. context가 없으면 기존 PostgreSQL을 사용하고 context에 저장소가 빠졌으면 차단한다. HTTP 입력이나 새 환경변수로 MongoDB를 선택하지 않는다.

## 삭제 코치 보완

이전 PostgreSQL 코드는 ID만으로 update하여 삭제된 코치도 재발급할 수 있었다. 이제 양 backend 모두 삭제되지 않은 행만 갱신한다. 없거나 삭제된 코치는 API 404다. 이는 의도한 보안 보완이며 인증 범위를 변경하지 않는다.

PostgreSQL은 `update where { id, deletedAt: null }`의 원자 조건을 사용한다. 선행 조회만으로 삭제 여부를 판단하지 않아 동시 삭제와도 일관된다. P2025만 없는 행으로 변환하고 나머지 오류는 일반 실패로 전달한다. 기존 Prisma 암호화 처리와 DB 변경 감사 trigger를 유지한다. 실제 PostgreSQL 실행은 이번 단위 검사에서 대역이다.

## MongoDB 원자성

`MongoCoachTokenRotationRepository`는 명시 shadow DB/namespace만 허용한다. 쓰기 gate와 replica session, Coach/ActivityChange validator/index 준비를 open에서 읽기 전용으로 확인한다. 준비는 별도 `prepareMongoCoachTokenRotationStore`에서만 한다.

snapshot transaction에서 삭제되지 않은 Coach를 읽고 새 32바이트 난수 토큰을 생성한다. 이전 blind index 저장필드는 제거한 뒤 기존 codec으로 토큰을 암호화하고 HMAC를 다시 계산한다. ID와 `deletedAt: null`을 조건으로 문서를 교체하고 같은 session에 redacted 변경 감사행을 삽입한다. 동시 삭제가 먼저 확정되면 write conflict를 재시도하면서 삭제 상태를 확인하여 null을 반환한다.

unique 충돌이나 감사 저장 실패는 문서와 감사행 전체를 rollback한다. 오류 메시지에 토큰이나 원본 driver 오류를 노출하지 않는다. 토큰 충돌을 임의의 다른 토큰으로 조용히 재시도하지 않으며 호출이 실패하므로 기존 링크가 유지된다. 정상 회전 뒤 시작한 토큰 조회에서 이전 토큰은 조회되지 않고 새 토큰만 유효하다. 이미 진행 중인 이전 snapshot 요청까지 취소한다는 보장은 하지 않는다.

활동 context가 있는 요청에서는 토큰의 실제 값 대신 `{ redacted: true }`를 감사 변경 내용으로 남기고 그 감사행도 암호화한다. 기존 helper처럼 context 없는 직접 호출에는 감사행이 생성되지 않는다. 실제 API 경계의 activity wrapper 전달은 통합 검증 대상이다.

## 검증과 남은 범위

- 단위 검사 5개 통과: Prisma 삭제 조건·P2025, factory 기본값과 fallback 차단, 토큰/검색 HMAC 갱신, 암호화·감사, 삭제·충돌·감사 실패 rollback, 실제 API handler의 인증 선행·성공 응답·404.
- handler 검사는 실제 소스 코드를 실행하지만 workspace 인증과 activity wrapper는 대역이다. OAuth와 실제 브라우저 로그인 검증을 대신하지 않는다.
- native 테스트 `mongoCoachTokenRotationRepository.integration.test.ts`는 명시 `MONGODB_COACH_ACCESS_TEST_URI` loopback replica만 사용한다. 자체 합성 DB/키를 생성하고 종료 시 삭제·복구한다. 실제 토큰 조회 adapter와 이전/신규 링크, unique 충돌, 감사 실패, 조회 직후 동시 삭제를 검사한다. 토큰 충돌과 조회 시점 조절은 private 테스트 seam에만 적용하며 공개 API에 토큰 지정 옵션을 추가하지 않는다.
- 이 담당의 최초 로컬 실행에서는 native URI가 없어 1개 생략했다. 통합 실행 결과는 총괄 검증 보고서와 구분한다.
- 운영 DB·키·서비스 저장소 선택·배포는 변경하지 않았다. 실제 운영 데이터 복사와 전체 앱 전환, PostgreSQL의 실제 경쟁 삭제 검증은 남아 있다.

## 독립 검토 보완

API 경계에서 UUID 형식을 확인하고 유효한 코치 ID만 소문자로 정규화한다. 대문자·혼합 표기의 동일 UUID가 PostgreSQL과 MongoDB에서 동일한 행을 가리키도록 하며 잘못된 형식은 저장소 호출 전에 400으로 거절한다. bearer 토큰 문자열의 대소문자는 변경하지 않는다.

재발급 성공 응답과 명시 400/404 응답에는 `Cache-Control: private, no-store`를 설정한다. native 검사에는 같은 코치에 대한 재발급 두 요청을 동시에 실행하여 두 응답 중 마지막으로 저장된 토큰 하나만 실제 조회에 성공하는 반례를 추가했다. 두 요청 모두 성공했더라도 먼저 발급된 링크가 최신 링크로 대체될 수 있는 기존 재발급 의미를 유지한다.
