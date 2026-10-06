# 원본 의미와 실행 경계

기준 a52f191의 salesRevenueSync.ts/실제 admin/sales-revenue/route.ts/sourceReads/salesmapSourceReader.ts 직접 확인. 전체 기본 PG. schema Course Decimal(14,2), SalesRevenueSyncLog triggeredBy+HMAC/detail JSON은 기존 개인정보 정책에 포함. 새 schema 필요 없음.

- 원천 미설정이면 disabled/configured=false, failed면 configured=true의 빈 결과. 두 경로는 PG 및 sync log 없이 종료. failed 판단 전에 items 필터와 resolution 키 정규화 수행.
- 필터는 truthy courseId && revenue!=null; workflow에서 finite/positive를 추가하지 않음. 원천 reader는 finite 금액을 읽고 딜 ID 중복 제거, 원문 코스ID별 합산 및 합계<=0 제외. workflow는 다시 dedupe하지 않음.
- 코스 정규화는 U+200B..U+200D/U+FEFF/U+00A0 제거 후 trim. 정규화 resolution 키 충돌은 후행 우선. Course.courseId!='' 전체 조회, 삭제 회차 유무/회사와 무관하게 같은 정규화 ID의 모든 Course에 적용. PG 무정렬은 보장된 순서 없음.
- matched는 매칭 원천 레코드 수, updatedRows는 pending update 수(중복 포함). 같은 원천 반복도 최초 조회 snapshot의 before로 계산한다. 2+ 딜 sameAmount(default true)이면 max(default sum) 한 건; 이때 exclude 포함 resolution 무시. 다른 금액이면 sum(default)/max/min/exclude. exclude도 matched/multiCourse에는 포함, changes 없음.
- before는 Number 변환 후 finite 아니면 null. 응답 after는 JS 원금액, 저장은 Decimal 반올림, revenueRaw는 String(원금액). 원천 소수3자리 등은 재실행에도 change로 남을 수 있음. 기존 동작을 임의 개선하지 않음.
- partial+apply: 업무0, 고정 안내 issue 추가, applied=false, sync log 시도. partial preview: 차이만 표시. 정상 apply: pending 없어도 applied=true. 업무 오류: 함수throw, sync log 없음.
- pending 전부 한 PG interactive transaction(120초/maxWait10초), revenue/revenueRaw만 patch. sync log는 완료 뒤 별도 best effort. 최초500개 ID 배열, issues 전체, actorEmail 저장. 로그 실패해도 업무 유지.
- API admin 또는 SYNC_API_SECRET; 잘못된 bearer는 admin fallback. 불허403, 미설정400, 정상/failed/partial 응답200, thrown500. POST malformed JSON/미지원 mode는 무시. cron POST 미반영/throw만 Slack 알림, 실패 알림 자체 best effort. withActivity가 실제 권한과 독립적으로 요청 actor를 기록.
- 직접 알림은 원격 Slack이므로 명시 context의 source/repository 외 별도 notifier를 선해결해야 한다. 기본 notifier 기존 명단/대상조건 유지, 합성 notifier로 검증. 실제메시지 전송은 수행하지 않음.
- 원본 source catch/route catch는 raw error message를 반환/알림할 수 있음. 새 경계에서는 raw error를 고정코드로 정제하는 보안상 의도된 차이를 테스트/문서에서 분리. 허용된 preview의 Course/Company 이름은 유지.

대조 계획: 원본 함수를 기준 commit에서 동결하고 IO만 주입, 새 workflow/helper 공유 금지. PG/newPG/Mongo 출력/저장/audit 비교. 원본 무정렬 복수행은 표시 순서 차이가 허용되는 범위만 문서로 고정; 단일매칭/원천순서/카운트/값/첫항목 선택 규칙은 exact 확인. 실패문구만 안전 코드로 변경하며 status/업무/log side effect는 보존한다.
