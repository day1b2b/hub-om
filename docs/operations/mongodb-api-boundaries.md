# MongoDB 요청 경계와 검증 범위

2026-09-22 기준 코치 관리 API, 팀 사용자 facade, 강사노트 factory, 개인정보 접근 서비스와 요청 감사를 명시적인 요청 단위 저장소에 연결했다. 기본 운영 선택은 PostgreSQL이며 자동 Mongo 전환은 추가하지 않았다.

## 저장소 선택 계약

`runWithDataRepositories(repositories, work)`는 내부 코드가 이미 준비한 저장소를 해당 비동기 작업에만 주입한다. 전역 AsyncLocalStorage로 중첩·병렬 요청을 분리하고 주입 map을 복사·동결한다. HTTP header/cookie, 사용자 입력, 환경변수로 이 scope를 선택할 수 없다. actor 값을 제공하는 것으로 인증·인가를 대신할 수 없다.

- scope 없음: 기존 Prisma 또는 해당 기능의 개발용 local 분기를 유지한다.
- scope 있음: 필요한 서비스가 없으면 `DATA_REPOSITORY_NOT_CONFIGURED`로 실패한다. 누락 서비스를 PG로 재시도하지 않는다.
- `withActivity` handler에는 업무 저장소 외 `requestActivity`도 필요하다. recorder 누락은 handler 실행 전에 거절한다.
- scope 안에서는 `getPrismaClient()`가 cached client를 반환하기 전에 차단하고 Calendar의 별도 PG lock도 차단한다. 이미 scope 밖에서 확보한 Prisma 객체 자체를 무효화하지는 않는다. 추후 연결 작업은 외부에서 미리 캡처한 client가 없는지도 검토해야 한다.
- open은 기존 shadow schema와 index를 검사한다. setup/prepare만 명시 허용된 shadow namespace에 validator/index를 만든다. 런타임 open에 DDL이나 생산 선택을 섞지 않는다.

## 권한과 감사

| 동작 | 실패 시 계약 |
| --- | --- |
| 인증·권한 검사 | 기존 세션 및 권한을 검사한다. Coach/Instructor 실제 handler는 무인증 쓰기를 거절한다. |
| 변경 감사 ActivityChange | Coach/Team/Instructor 업무와 동일 transaction이다. 감사 저장 실패 시 업무 변경도 rollback한다. PII diff는 redacted 처리하며 actor/changes는 codec으로 암호화한다. |
| 요청 로그 ActivityRequest | handler 완료 후 best-effort 기록. 기록 실패로 이미 성공한 업무를 실패로 바꾸지 않으며 일반화된 로그만 남기고 PG 재시도하지 않는다. |
| 개인정보 접근 로그 | 서비스는 권한 확인 → 감사 성공 → 개인정보 읽기 순서다. 감사 실패 시 민감 데이터를 읽거나 반환하지 않는다. |
| 보존 기간 | 요청 로그 30일, 변경 이력 365일. 모델별 최대 1,000건씩 shadow namespace 안에서 정리한다. 개인정보 접근 로그의 신규 삭제 정책은 만들지 않았다. |

TeamUser 물리삭제는 기존 정책 충돌로 계속 차단한다. 중복 이메일 경쟁 방지 guard는 모든 TeamUser writer가 참여해야 한다. 미전환 경로를 포함한 전체 앱에서 이 조건을 만족했다는 뜻은 아니다.

## 검증과 한계

- 합성 세션을 사용하는 실제 auth guard·withActivity·Coach POST/PUT·Instructor save handler와 Team facade를 MongoDB 8.0.30 단일 노드 replica set에 연결했다. OAuth 로그인 자체를 실행한 검사는 아니다.
- 권한 거부, 부분 수정 보존, 암호문 저장, 후행 감사 실패 후 선행 업무/감사 원복, 접근 감사 실패 시 민감 조회 0회, 요청 감사 실패 후 성공 응답 유지, PG/Calendar 차단을 확인했다.
- 별도 Coach management suite는 auth/activity wrapper를 mock하여 여섯 HTTP handler의 DTO/상태코드와 실제 Mongo 업무 저장을 확인한다. PG adapter 대조는 mock이며 실제 PG 데이터 쿼리 대조가 아니다.
- 명시 loopback URI를 주는 Mongo 검증 묶음은 30 pass / 0 fail / 0 skip이며 TeamMember mock 검사 4개를 포함한다. URI 없는 전체 회귀는 814 pass / 12 skip. 결과를 합산하지 않는다.
- 타입 검사·앱 빌드 통과, lint 오류 0개와 기존 경고 7개. 실행 근거는 `.claude/plans/mongodb-api-boundaries/execution-manifest.md` 참조.
- 관리 조회의 2만행/32MiB scan 한도, 운영 데이터량에서의 이름 검색/정렬 성능은 미해결이다.
- 개인정보 서비스 검증은 실제 `api/coaches/export` 이전을 뜻하지 않는다. export·토큰 인증·일정/예약/섭외·외부 동기화·Calendar·관리 도구 등은 여전히 PG다.
- 운영 Mongo cluster의 실제 권한/부하/복구, 생산 UI, 실데이터 복사와 최종 동기화, 배포는 이번 검사에 포함되지 않았다. 브라우저 초안 암호화 검증도 별도 범위다.

전체 남은 경로는 [런타임 범위](mongodb-runtime-coverage.md)를 따른다. PostgreSQL 운영을 유지하며 나머지 기능 연결과 전환 리허설을 완료한 뒤 생산 선택을 바꾼다.
