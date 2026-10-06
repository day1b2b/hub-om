# 계획 v1

핵심 난이도: exact 예약이메일, roster 정규화이메일, 자유텍스트 이름매칭의 서로 다른 조건과 관계 우선순위를 보존하며 암호화된 Mongo에서 같은 결과를 얻는 것이다.

1. [Core] 기존 필터/집계/권한/빈값과 모호성을 fixture로 고정한다. 이메일 exact와 이름 normalized를 섞지 않는다. 예약 coach 우선과 cancelled link조건을 그대로 둔다.
2. [Shell] interface/factory/PG adapter로 이동하고 facade/DTO/partition은 호환 유지한다. grouping순수함수만 공유한다. context가 없으면 PG, 명시scope의 coachManagerMyPage 누락은 실패.
3. [Core] Mongo 한 메서드는 snapshot transaction 내 TeamUser/예약/투입/코치/슬롯을 읽는다. 정확 이메일 HMAC+원문검증, 이름contains는 bounded decoded scan후 원래포함+split조건. TeamUser 직접snapshot조회는 기존 listTeamUsers의 PG정렬/이름해석을 보존해 다른 backend나 localfallback으로 새지 않는다.
4. [Check] 실제 PG/Mongo 동일fixture, actual pageadmin/세션email/빈화면/분류props, snapshot경쟁/다중page/암호문변조/키/오류/평문/다른담당자 분리검증.
5. [Check] 전체test/type/lint/build와 영향Mongo회귀, 독립리뷰 및 지적보완. coverage/macro/manifest/handoff갱신, featurecommit/push/remoteSHA확인, 소유DB정리.

대안: teamUsers 별도repository 호출은 재사용이 쉽지만 확인된 명단과업무데이터가 같은snapshot이 아니다. 이 조회 전용 adapter가 TeamUser를 같이 읽는 방식을 선택한다. 기존 이름모호성을 새정책으로 막는 것은 이번전환범위와 다르므로 제외한다.
