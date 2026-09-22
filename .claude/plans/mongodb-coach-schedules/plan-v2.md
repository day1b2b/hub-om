# Plan v1
1. [Core] 계약 판독: 날짜가 실제calendar일이면 UTC일자로 변환하고 아니면400. month 범위는 유효한 월의 첫날~말일. token auth와 workspace auth를 그대로 유지한다. GET self만 accessedAt 변경, PUT은 기존 accessedAt 유지하며 lastEditedAt 변경. confirmed schedules는 취소되지않고 engagement가 scheduled/in_progress/completed일때만 응답한다.
2. [Core] 저장소: 명시 scope의 coachSchedule 주입, 누락시 실패; scope없으면 PG adapter. Mongo 모델codec 암호화와 변경감사를 모든 mutation transaction에 묶는다. 월 replacement는 delete/create/accesslog 하나의 transaction. 동일 월 accesslog unique/upsert conflict로 재시도시 월전체 스냅샷을 새로 읽는다. 예약은 coachId/date active partial unique index와 전체transaction duplicate retry로 최종 실제 승자를 응답. 취소는 요청자 email에 일치하는 active row만 cancelledAt 변경, 이력 보존. 기존 중복 active data가 있으면 setup실패하며 자동정리하지 않는다.
3. [Shell] 기존 handler PG delegate를 계약호출로 이전, DTO/오류/status 보존. 신규 의존성·schema·환경selector 없음. PG 경합대책은 기존 스키마에 맞는 transaction 직렬화로 제한하며 생산 실행하지 않는다.
4. [Check] 순수 날짜/월/null검증 + actualhandler auth/DTO/confirmed/accesslog + nativeMongo concurrent same-date owner/cancel/re-reserve + late 감사failure 원자rollback + raw암호화 + contextfailclosed. local loopback replica set 합성데이터, env -i 임시키, DATABASE_URL 제거, finally정리.
5. [Check] 전체test/type/lint/build, 독립 구현리뷰, 발생gap최소보완/재검증. docs coverage/실행증거/남은외부검증/후속handoff를 기록하고 feature커밋/push.
대안: shared guard 컬렉션은 모든 writer참여가 필요하고 추가내부모델이 필요; active partial unique index는 서버가 중복을 차단하므로 선택. 운영인덱스 변경은 이작업에 포함하지 않는다. Mongo로 생산factory 바로전환은 남은PG직접경로가 있으므로 제외.

보완: existing log lastEditedAt를 max(now,prev+1ms)로실제변경하여no-op회피; validation-v2가최종기준. 기존 activity field-policy/table-exclusions 준수(AccessLog중복감사제외), mutation 감사context없으면진입차단. auditfail과accesslogfail은별도rollbackcase. engagement/sync/autocancel/삭제writer의통합은다음scope/생산전환차단게이트.
