# OM 요청 접수·조회·수정·삭제의 Mongo 경계

생산 기본은 PostgreSQL(개발 local 분기 유지)이다. 명시 검증 문맥에서만 OmRequest/MongoOperationRepository와 합성 부수 작업을 주입한다. 실제 복사·운영 전환이나 배정 전환 완료를 뜻하지 않는다.

## 이번 단위

`omRequestLocalRepository`는 기존 호출 이름을 유지하는 facade이며 기본 구현은 `legacyOmRequestRepository`다. 요청 목록·상세·입력 수정·삭제·대표 operation 연결·Slack 메타를 지원한다. 개인정보는 기존 privacy 정책과 snapshot/runtime codec을 사용하며 schema 변경은 없다. Mongo 요청 쓰기와 ActivityChange는 같은 트랜잭션이다.

`POST /api/om-request`의 핵심은 요청 저장이다. 날짜 있는 일정마다 운영 회차를 순서대로 생성하고, 결과보고서가 N이면 각 회차에 후속 수정한다. 대표 ID는 첫 회차다. 연결·도구 저장·알림·메타 저장은 각각 실패해도 요청 성공 201을 유지한다. 중간 회차 생성 실패 시 앞서 생성한 회차가 남고 대표 ID가 없을 수 있다. 재제출은 새 요청을 만들 수 있다. 이를 새 원자성·중복 방지 정책으로 변경하지 않았다.

회차 수의 유한한 소수 입력은 기존 Prisma와 같이 0 방향으로 소수 부분을 버리고 Int32 범위를 검사한다. 새 입력 정책을 도입하지 않았다.

PATCH는 입력 필드만 바꾸며 작성자·배정·운영 연결·알림 메타를 보존한다. 권한은 관리자 또는 저장된 ldEmail의 작성자다. DELETE는 관리자가 아니면 배정 전 작성자만 가능하고, 요청만 물리 삭제한다. 이미 연결된 운영 회차와 기존 감사는 삭제하지 않는다. 새 삭제 정책이 아니다.

요청 삭제·수정 전의 권한 조회는 원본처럼 업무 쓰기와 별도다. 같은 시점의 권한·배정 상태를 하나의 transaction으로 새로 강화하지 않았다. 생산 적용 전에는 원본의 이 경합 한계도 별도 검토해야 한다.

## 명시 문맥과 외부 효과

- 접수: `omRequests`, `operations`, `omCustomTools`, `omRequestNotifier`, `requestActivity`를 저장 전에 확보한다.
- 수정: `omRequests`, `omCustomTools`, `requestActivity`. 삭제는 도구/알림 없이 요청 저장소와 요청 감사만 쓴다.
- 페이지: 실제 사용하는 `operations`, `teamUsers`, `teamMembers`, `instructorNote`, `omCustomTools`, `omRequests`를 명시 주입한다. 문맥의 서비스 누락은 PG/local로 대체하지 않는다.
- `omCustomTools`는 파일 부수 작업을 대체하는 검증 port다. 새 Mongo 업무 모델은 만들지 않았으며 생산 도구 파일의 이전은 별도다.
- 접수 알림은 합성 notifier로 검증한다. 운영 알림의 webhook/bot/명단 조회는 기본 adapter에 그대로 남으며 실제 전송하지 않는다. Mongo operation을 주입할 때 기본 캘린더 wrapper는 실행하지 않는다. 캘린더 전환은 별도다.

POST는 기존처럼 공통 인증 proxy에 의존한다. handler에 새 401 규칙을 넣지 않았다. 합성 세션으로 실제 handler를 검증하는 것과 실제 브라우저 로그인·proxy·배포 검증은 다르다.

## 배정은 후속 필수 단위

`previewOmAssignment`, `assignOmRequestAtomically`, 옛 `updateOmRequestAssignment`는 명시 데이터 문맥에서 배정 미지원으로 거부한다. PG 배정의 기존 확인 토큰·권한·전체 회차 처리·외부 반영은 유지한다. 이번 변경을 Mongo 배정 가능으로 해석하지 않는다.

후속에서는 생성 감사 metadata batch로 확정한 전체 회차, 10분 확인 토큰, 수동 이름/계정 해제, 상태 전이, 동시 배정/일반 운영 writer 경합과 rollback을 실제 원본 PG와 대조해야 한다. 과거 연결 근거 누락은 현행409이며 이름/과정 기반으로 임의 확장하지 않는다.

## 저장·오류·한계

개인정보 필드와 HMAC은 기존 정책에 따른다. API의 허용된 복호화 응답과 합성 notifier 전달은 저장 평문과 구분한다. 예외 원문을 접수 로그에 남기지 않는다. 수정은 입력 필드와 해당 companion만 쓰며 재시도는 최신 행을 다시 읽는다. PG에서 검색 index 없는 sessions JSON의 재암호화가 남기는 redacted 감사를 Mongo에서도 기록한다.

Mongo 메서드 전체 30초 budget, snapshot/majority+j transaction과 기존 20,000행/32MiB/15초 scan 제한을 사용한다. 기존 namespace 정책 불일치를 자동 수리하거나 삭제하지 않는다. 실제 운영 규모·장애 네트워크에서 결과 불명확한 commit·전체 브라우저는 별도 검증이다.

검증·리뷰·원격 통합의 최신 상태는 `.claude/plans/mongodb-om-requests/` 실행·인계 문서를 따른다. 검증 준비나 구현만으로 PASS를 선언하지 않는다.
