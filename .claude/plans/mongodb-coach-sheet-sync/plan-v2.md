# Plan v2

핵심 난이도: 시트 predicate가 빈 집합일 때도 concurrent writer와 일관된 결과를 만들고 기존 부분 성공을 보존한다.

1. [Core] 원천을 tx 밖에서 읽고 단일 workflow로 파싱/count/sourceID/merge를 유지한다. contract는 코치별 보충 tx 후 engagement별 tx, 삼성은 보충 후 전체 replacement tx. 전체 atomic화 대안은 기존 재시도/부분실패 의미 변경으로 제외한다.
2. [Core] catalog→정렬 coach guard. identity/삭제 predicate 조회 전에 catalog 획득, 이전·새 target 전부 coach lock 후 재조회, 이후 업무쓰기. 수기 engagement create/update와 관리 create/update/delete도 catalog 참여. reservation/month/review는 coach만으로 기존 경쟁 직렬화. 뒤늦은 잠금 금지.
3. [Core] private truthy 기존값 유지, contract review/hiring ID 보존. 삼성은 source와 무관 지정 course 삭제, slots cascade/confirmed link null. 빈 entries도 기존 전체삭제 계약 유지.
4. [Shell] repo/source/log interface·PG기본/Mongo context 연결. Notion은 scoped 진입시 외부읽기 전 차단. log는 시작→업무→종료의 기존 독립 lifecycle.
5. [Check] 합성 source 실제 service/handler로 두 순서 경쟁·최초upsert·retry·audit rollback·ciphertext·auth·누락 context·dryrun no-write·partial failure 증명. Node24 env-i/owned Mongo8 replica만 사용. 전체 test/type/lint/build 및 독립리뷰.
6. [Shell] coverage/운영문서/artifacts 갱신, feature commit/push와 remote SHA 확인, 테스트 DB/프로세스 정리. 운영전환·PG실경합·실원천 미검증 표기.

보완: 삼성삭제전 confirmedEngagementId로연결된예약들의coach도수집하여전체정렬잠금에포함. 기존public/private보충은한tx로강화. source adapter오류는고정메시지로경계처리. 실행후독립검토에서기준별실증을대조한다.
