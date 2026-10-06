# 실행 계획 v1

핵심 난이도는 기존 응답·권한·감사 계약을 보존하며 Mongo에서 외래키와 삭제 경합을 재현하는 것이다.

1. [Core] 기존 route/helper의 조건과 응답을 고정한다. context가 있으면 지정 저장소만 사용하고, 없으면 기존 PG를 선택한다. 누락 context는 실패해야 한다.
2. [Shell] interface, PG adapter, factory, route/page 연결을 분리한다. 프로필/후기 helper 기존 호출부에 이력 중복이나 추가 의존성이 생기지 않아야 한다.
3. [Core] Mongo 쓰기는 코치 guard 획득 후 부모와 대상 행을 판정한다. note/history/audit가 같은 transaction에서 commit/rollback된다. purge와 양방향 충돌 시 고아 콘텐츠가 없어야 한다. 콘텐츠 응답에서 암호화 companion을 제외한다.
4. [Core] 피드의 source별 300개 제한은 서버에서 적용하고 복호화·연결 후 응답한다. 등록 현황은 일정 건수가 아닌 접근 로그로 판정한다. 기존 모호한 동률 순서는 새 정책으로 단정하지 않는다.
5. [Check] 합성 PG/Mongo 동등성, 실제 인증/요청 감사/페이지, 실패 주입·동시 토글·purge 경합·개인정보 비노출을 검증한다. 검증 fixture와 구현의 결합을 줄이고 기존 PG를 비교 기준으로 사용한다.
6. [Check] 전체 회귀와 독립 리뷰 후 필요한 수정만 재검증한다. coverage/macro/실행/인계를 갱신하고 commit/push 및 원격 SHA를 확인한다.

대안: factory만 교체하면 비용은 작지만 직접 페이지·helper 호출과 경합이 남는다. 흐름 전체의 저장 경계를 분리하는 위 방식을 선택한다. 영구삭제 비활성화는 기존 사용자 선택과 달라 채택하지 않는다.
