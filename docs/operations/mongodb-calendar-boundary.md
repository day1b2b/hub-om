# Calendar 병행 저장·잠금 경계

명시 Mongo 경계의 구현·합성 검증·독립 리뷰를 마쳤다. 최종 판정과 원격 통합 근거는 `.claude/plans/mongodb-calendar-boundary/`를 따른다. 기본 운영 backend는 PostgreSQL이며 실제 Google·운영 DB·배포 설정은 바꾸지 않았다.

## 적용 범위

가져오기 반영 POST의 업무 commit 이후 기존 Calendar 보충 함수를 실행하고, 명시 Mongo runtime에서 연결 정보와 변경 감사를 함께 저장한다. 기존 CalendarEventLink 모델·암호화·HMAC index를 사용하며 업무 필드나 삭제 정책은 추가하지 않는다. mapping의 고유 키는 운영 ID+교육일이다. calendarId+eventId에 새 unique를 만들지 않는다.

runtime은 하나의 client/database/namespace에서 operations, teamUsers, teamMembers, importPromotion, importPromotionCalendar, requestActivity, calendarPersistence, calendarLock을 함께 연다. 누락·다른 runtime의 포트 혼합은 작업과 요청 감사가 시작되기 전에 거부한다. 일반 운영 반영 wrapper는 builder가 등록하기 전에 선택한다. 전역 factory의 기존 PG 선택은 유지한다.

새로 가져온 운영의 educationDates가 비어 있으면 Calendar 보충에서 제외되는 원래 동작을 유지한다. 교육일을 가진 삭제 운영의 복원과 기존 활성 운영이 종단 검증의 양성 사례다. 보충 범위는 해당 가져오기 run으로 새로 제한하지 않는다.

## 잠금·실패의 의미

별도 내부 CalendarOperationLease collection을 사용한다. 서버 시간으로60초 유효기간을 판단하고15초마다 갱신한다. owner와 Long generation을 함께 검사하며 TTL 삭제로 소유권을 판정하지 않는다. 요청당 전체 관찰 예산180초, coordination IO5초, mapping transaction CSOT10초다. 실패한 transaction의 driver abort 정리는 별도 시간이 들 수 있다.

같은 회차의 재진입은 같은 잠금을 사용한다. 다른 회차·다른 runtime의 중첩은 작업 시작 전에 거부한다. mapping 변경은 같은 transaction에서 유효 소유권 문서의 nonce를 실제 갱신한 뒤 연결 정보와 감사를 쓴다. 이 보호는 일반 운영 writer 전체를 직렬화하는 장치가 아니다.

PG session lock과 달리 프로세스가 오래 멈추면 Mongo lease가 만료된다. 이미 전송된 Google 요청이나 이미 commit된 DB 작업은 잠금 상실로 취소되지 않는다. Google 성공 후 mapping이 실패하면 외부 일정만 남을 수 있고, 다음 요청은 기존 결정적 이벤트 ID와 표식 확인으로 연결을 복구한다. 외부 호출·메일 exactly-once 또는 회차 전체 rollback을 보장하지 않는다.

DB transaction callback 재시도는 같은 소유권을 다시 확인하지만, 이미 commit한 transaction의 ACK 재확인은 새 Google 요청이나 새 mapping callback을 실행하지 않는다. 결과 불명과 확정 성공을 구분한다. commit 이후 Calendar 실패는 업무 commit을 되돌리지 않는다.

## 저장·노출·준비

승인된 응답의 복호화 값·알림 본문은 기존 계약대로 유지한다. 저장은 기존 암호화 정책을 적용하고 감사는 민감 값을 가린다. 이번 Calendar 흐름의 로그와 실패 응답에는 원문 오류·이름·이메일·calendar/event ID·token을 전달하지 않는다.

prepare는 별도 shadow namespace에서만 명시적으로 실행한다. CalendarEventLink·OperationSession·ActivityChange의 기존 metadata와 문서 정책을 먼저 읽어서 확인하고, 없는 collection만 준비한다. 현재 validator가 붙어 있어도 과거 정책의 문서가 남아 있으면 거부한다. 잘못된 metadata나 lease 문서를 자동 초기화하지 않는다. open과 일반 요청은 schema/index를 수리하지 않는다. 유효 형식의 잘못된 HMAC 키는 equality miss를 만들 수 있고, 해당 행의 공개 키/전체 조회는 codec의 HMAC 검증에서 실패한다. 키 구성 검증과 실제 데이터 대조는 운영 연결 전 별도 gate다.

## 아직 완료되지 않은 것

일반954pass/77skip, 원본 PG 비교5pass/0skip, 전체Mongo963pass/0skip(기존 mock4 포함), typecheck/build 통과, lint 오류0·기존경고7. 전체 실행 뒤 테스트 단언만 강화한 adjacent12pass는 부분집합으로 별도 기록하며 합산하지 않는다. 제품 코드는 동일하다. 소유 합성 DB·프로세스·dbpath 정리와 포트 닫힘을 확인했다.

실제 Google 권한·계정·메일, 예약 job 연결, 전체 앱 backend 조립과 모든 진입점의 preflight, 실제 원천·Drive·활동 보존·backup/health·CLI는 별도 범위다. 실제 독립 A/B 백업·복원·최종 복사·무손실 복귀·운영 전환은 미완료이며 dev→main 조건도 아직 충족하지 않았다. 브라우저 임시 초안 암호화는 별도 후속이다.
