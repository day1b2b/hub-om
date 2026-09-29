# 매출 동기화의 Mongo 검증 경계

생산 기본은 PostgreSQL이다. 이 단위는 관리자 매출 동기화 GET/POST에 명시적으로 주입하는 Mongo 저장소·원천·알림 경계다. 실제 Salesmap 읽기, Slack 전송, 운영 금액 변경이나 배포는 실행하지 않았다.

## 연결과 보존한 동작

`salesRevenueSync`, `salesRevenueSource`, `salesRevenueNotifier`, `requestActivity`가 명시 scope의 필수 서비스다. 누락 시 기본 PG·실원천·실알림으로 넘어가지 않으며 업무 전에 실패한다. scope 밖의 기본 PG 및 기존 admin/secret 인증, 잘못된 bearer의 admin fallback은 유지한다. 요청 감사 서비스 누락은 handler 진입 전 예외이고, 나머지는 인가된 handler에서 안전한 500 응답이다.

코스ID의 보이지 않는 문자·앞뒤 공백을 정규화하고 같은 ID에 연결된 모든 과정을 반영한다. 원천 레코드 순서·중복과 최초 조회의 비교값을 유지한다. 반영 건수는 고유 과정 수가 아니라 실제 pending 수다. 동일 금액 다중 딜은 한 건 금액, 서로 다른 딜은 기존 sum/max/min/exclude 선택을 따른다. partial 조회는 미리보기만 계산하고 실제 업무 쓰기를 막는다.

응답 금액과 `revenueRaw`는 원천 JS number와 `String(number)`이고, 저장 금액은 PG Decimal(14,2) 반올림과 범위를 따른다. 예를 들어 합성값 1.005는 저장 시 1.01이므로 재실행에도 change로 나타난다. 기존 Prisma에서 비유한 number가 NULL로 저장되는 동작도 유지한다. 이 동작의 정책 개선은 전환과 구분한다. 관리자 편집의 기존 반올림 helper를 공유하지만 공통 codec의 허용 범위는 완화하지 않았다.

## 트랜잭션과 한계

Mongo는 Course와 Company를 같은 조회 snapshot으로 읽는다. 실제 쓰기는 한 트랜잭션에서 최신 Course를 다시 읽고 `revenue`, `revenueRaw`, `updatedAt`만 갱신하며 변경 감사를 함께 저장한다. 드라이버 재시도에서도 최초 pending·응답은 고정하고 최신 쓰기 전 값으로 감사를 계산한다. 같은 논리값의 timestamp 갱신은 변경 감사를 추가하지 않는다.

`applyUpdates` 전체 기한은 120초이며 재시도마다 초기화하지 않는다. 확인된 abort는 업무·변경 감사를 모두 취소한다. 기한 내 커밋 결과를 확인하지 못한 경우에는 미반영을 단정할 수 없어, 오류 알림에서 반영 결과 확인을 안내한다. 실제 네트워크 단절에 따른 커밋 불명확 상황 자체는 이번 합성 검증 범위 밖이다.

동기화 요약 로그와 요청 감사는 별도 best effort다. 이 둘의 실패는 성공한 업무를 취소하지 않는다. 업무 실패 후에는 요약 로그를 생성하지 않는다. cron POST 미설정·미반영·오류에서만 기존 알림을 시도하며, 알림 실패도 결과를 바꾸지 않는다.

수동 매출 우선권이나 과정 생성까지의 전역 직렬화를 새로 추가하지 않았다. 최초 조회에서 same이었던 행을 나중에 수동 수정해도 이번 pending에 추가하지 않는다. 조회 이후 생성·이동된 과정, 복원이 이전 매출을 복사하는 경우는 원본과 같은 한계다. 일반 과정 편집·관리자 셀 편집과 동일 문서에서 경합할 때는 실제 write conflict와 재시도로 무관 필드 손실을 막는다.

조회 순서는 원본 PG에서 보장하지 않는다. 복수 과정 표시 순서는 달라질 수 있으며 다중 딜의 표시 이름은 각 backend의 첫 매칭 행을 따른다. 매칭된 이름·금액·action의 연결과 전체 대상, 원천 순서·중복을 비교에서 제거하지 않는다. bounded scan은 모델별 20,000행/32MiB/15초 한도가 있으며 초과 시 부분 결과를 사용하지 않는다. 운영 규모의 부하 검증을 대신하지 않는다.

## 개인정보와 적용 순서

기존 정책의 SalesRevenueSyncLog.actor(`triggeredBy`)·detail과 요청/변경 감사의 actor·changes를 암호화한다. HMAC와 인증 복호화를 검증하며 원천·드라이버 예외 원문을 API·알림·console로 보내지 않는다. 정해진 issue 코드와 공개 문구 형식만 유지하고 그 외는 고정 코드로 치환한다. 인가된 정상 미리보기의 회사·과정 이름은 유지한다. Course/Company의 현재 정책과 전체 앱의 개인정보 암호화를 혼동하지 않는다.

새 schema/migration/의존성은 없다. 검증용 replica set과 새 shadow namespace를 준비하고, codec/validator/index 준비 상태를 확인한 repository와 합성 source/notifier를 scope에 주입한다. 기존 namespace의 불일치는 자동 삭제·수리하지 않는다. 운영 연결은 전체 앱 구성·실제 복사/복원·백업·실행 범위·복귀 조건 확인 이후 별도 절차다. 코드 복구 시 기능 commit을 되돌릴 수 있으나, 성공한 실제 금액 반영은 코드 되돌리기만으로 복구되지 않는다.

검증·실패 보완·독립 리뷰·원격 통합은 `.claude/plans/mongodb-sales-revenue-sync/`를 따른다. 실제 PG17.9와 Mongo8.0.30, Node24.19.0의 새 loopback 합성 DB만 사용했다. 운영 PG18, 실제 원천/브라우저/생산 구성·복사·복원·전환은 미검증이다. 다음 후보는 OM 접수·배정이며 전체 완료 전 dev→main 병합은 진행하지 않는다.
